import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AgentRegistry } from "../agents/registry.js";
import { initializeConfig, loadConfig, setSelectedRuntime, stateDirectory } from "../config.js";
import { scaffoldProject } from "../context/scaffold.js";
import { TaskStore } from "../store/task-store.js";
import type { RuntimeName, RuntimeProbe } from "../runtime/types.js";
import { getRuntimeAdapter, getRuntimeAdapters } from "../runtime/registry.js";
import { loadWorkflow } from "../workflows/loader.js";
import type { HandoffContract, TaskContract } from "../tasks/contracts.js";
import type { WorkflowRun } from "../workflows/runs.js";
import type { ApprovalRequest } from "../approvals/contracts.js";

const execFileAsync = promisify(execFile);

let runtimeProbeCache: { expiresAt: number; result: Promise<RuntimeProbe[]> } | undefined;

function probeRuntimes(): Promise<RuntimeProbe[]> {
  if (runtimeProbeCache && runtimeProbeCache.expiresAt > Date.now()) return runtimeProbeCache.result;
  const result = Promise.all(getRuntimeAdapters().map((adapter) => adapter.probe()));
  runtimeProbeCache = { expiresAt: Date.now() + 30_000, result };
  return result;
}

export interface DesktopProjectSnapshot {
  root: string;
  name: string;
  initialized: boolean;
  runtime: RuntimeName | null;
  runtimes: RuntimeProbe[];
  git: { isRepository: boolean; branch: string | null; clean: boolean };
  agents: Array<{ id: string; name: string; description: string }>;
  workflows: Array<{ id: string; name: string; description: string; stepCount: number }>;
  tasks: TaskContract[];
  handoffs: HandoffContract[];
  runs: WorkflowRun[];
  approvals: ApprovalRequest[];
}

async function resolveProjectRoot(candidate: string): Promise<string> {
  const root = await realpath(candidate);
  const details = await stat(root);
  if (!details.isDirectory()) throw new Error("Select a project folder.");
  return root;
}

async function readGitStatus(root: string): Promise<DesktopProjectSnapshot["git"]> {
  try {
    const repository = await execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    const branch = await execFileAsync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8" });
    const status = await execFileAsync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });
    return {
      isRepository: path.resolve(repository.stdout.trim()) === root,
      branch: branch.stdout.trim() || null,
      clean: status.stdout.trim().length === 0,
    };
  } catch {
    return { isRepository: false, branch: null, clean: false };
  }
}

async function readHarnessDefinitions(harnessRoot: string): Promise<Pick<DesktopProjectSnapshot, "agents" | "workflows">> {
  const registry = await AgentRegistry.load(harnessRoot);
  const agents = registry.list().map(({ id, name, description }) => ({ id, name, description }));
  const workflowIds = ["idea-validation", "feature-delivery", "weekly-operations"];
  const workflows = await Promise.all(workflowIds.map(async (id) => {
    const workflow = await loadWorkflow(harnessRoot, id);
    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      stepCount: workflow.steps.length,
    };
  }));
  return { agents, workflows };
}

export async function inspectDesktopProject(candidateRoot: string, harnessRoot: string): Promise<DesktopProjectSnapshot> {
  const root = await resolveProjectRoot(candidateRoot);
  let runtime: RuntimeName | null = null;
  let initialized = false;
  try {
    runtime = (await loadConfig(root)).runtime;
    initialized = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const [runtimes, definitions, git] = await Promise.all([
    probeRuntimes(),
    readHarnessDefinitions(harnessRoot),
    readGitStatus(root),
  ]);

  let tasks: TaskContract[] = [];
  let handoffs: HandoffContract[] = [];
  let runs: WorkflowRun[] = [];
  let approvals: ApprovalRequest[] = [];
  if (initialized) {
    const store = await TaskStore.open(path.join(stateDirectory(root), "state.db"));
    try {
      tasks = store.listTasks();
      handoffs = tasks.flatMap((task) => store.listHandoffs(task.id));
      runs = store.listWorkflowRuns();
      approvals = store.listPendingApprovals();
    } finally {
      store.close();
    }
  }

  return {
    root,
    name: path.basename(root),
    initialized,
    runtime,
    runtimes,
    git,
    ...definitions,
    tasks,
    handoffs,
    runs,
    approvals,
  };
}

export async function initializeDesktopProject(
  candidateRoot: string,
  harnessRoot: string,
  runtime: RuntimeName,
): Promise<DesktopProjectSnapshot> {
  const root = await resolveProjectRoot(candidateRoot);
  const adapter = getRuntimeAdapter(runtime);
  const probe = await adapter.probe();
  if (!probe.available) throw new Error(`${runtime} is not available: ${probe.error ?? "command not found"}`);
  await initializeConfig(root, runtime);
  await scaffoldProject(root, path.join(harnessRoot, "templates"));
  return inspectDesktopProject(root, harnessRoot);
}

export async function setDesktopRuntime(candidateRoot: string, harnessRoot: string, runtime: RuntimeName): Promise<DesktopProjectSnapshot> {
  const root = await resolveProjectRoot(candidateRoot);
  const adapter = getRuntimeAdapter(runtime);
  const probe = await adapter.probe();
  if (!probe.available) throw new Error(`${runtime} is not available: ${probe.error ?? "command not found"}`);
  await setSelectedRuntime(root, runtime);
  return inspectDesktopProject(root, harnessRoot);
}
