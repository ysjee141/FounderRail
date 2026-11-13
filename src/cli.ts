#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { compileAgentPrompt } from "./agents/prompt.js";
import { AgentRegistry, isAgentId } from "./agents/registry.js";
import { initializeConfig, isRuntimeName, loadConfig, setSelectedRuntime, stateDirectory } from "./config.js";
import { loadAgentContext } from "./context/loader.js";
import { scaffoldProject } from "./context/scaffold.js";
import { JsonlEventStore } from "./events/jsonl-store.js";
import { readBootstrapStatus } from "./knowledge/bootstrap.js";
import { auditKnowledge, compileKnowledge } from "./knowledge/cards.js";
import { collectWorktreeEvidence, createEngineeringWorktree } from "./engineering/worktree.js";
import { calculateRunway } from "./finance/runway.js";
import { deriveRiskFlags } from "./risk/router.js";
import { approvalDecisionSchema } from "./approvals/contracts.js";
import { decideApproval, requestApproval, requestWorkflowApproval } from "./approvals/service.js";
import { resolveExistingProjectFile } from "./security/project-path.js";
import { TaskStore } from "./store/task-store.js";
import { agentResultSchema, taskStatusSchema } from "./tasks/contracts.js";
import { loadWorkflow } from "./workflows/loader.js";
import { executeWorkflow, resumeWorkflow } from "./workflows/executor.js";
import { createRuntimeWorkflowRunner } from "./workflows/runtime-runner.js";
import { getRuntimeAdapter, getRuntimeAdapters } from "./runtime/registry.js";
import { parseAgentRuntimeResult } from "./runtime/result-contract.js";
import type { RuntimeMode } from "./runtime/types.js";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function valuesAfter(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] && !args[index + 1]?.startsWith("--")) values.push(args[index + 1] as string);
  }
  return values;
}

function usage(): void {
  console.log(`Usage:
  team init --runtime <claude|codex|gemini>
  team doctor
  team runtime show
  team runtime set <claude|codex|gemini>
  team agents
  team ask <agent-id> <request> [--dry-run]
  team bootstrap status
  team knowledge check
  team knowledge compile
  team task create --owner <agent-id> --objective <text> --why <text> [--write <path/**>]... [--forbid <action>]...
  team task show <task-id>
  team task transition <task-id> <status>
  team handoff record --task <task-id> --agent <agent-id> --from <json-file>
  team handoff list <task-id>
  team workflow inspect <workflow-id>
  team workflow list [--task <task-id>]
  team workflow show <run-id>
  team workflow run <workflow-id> --task <task-id> [--timeout-ms 300000]
  team workflow resume <run-id> [--timeout-ms 300000]
  team inbox
  team approval request --task <task-id> --action <name> --artifact <project-file>
  team approval decide <approval-id> <approve|reject|request_changes> --reason <text>
  team worktree create <task-id> [--base <git-ref>]
  team worktree inspect <task-id> --base-commit <sha>
  team risk classify <path-or-label>...
  team finance runway --cash <number> --revenue <number> --expenses <number>
  team run --prompt <text> [--mode read-only|workspace-write] [--timeout-ms 300000]`);
}

async function init(root: string, args: string[]): Promise<void> {
  const runtimeValue = valueAfter(args, "--runtime");
  if (!runtimeValue || !isRuntimeName(runtimeValue)) {
    throw new Error("--runtime must be one of: claude, codex, gemini");
  }

  const adapter = getRuntimeAdapter(runtimeValue);
  const probe = await adapter.probe();
  if (!probe.available) throw new Error(`${runtimeValue} is not available: ${probe.error}`);

  const config = await initializeConfig(root, runtimeValue);
  const scaffold = await scaffoldProject(root);
  console.log(JSON.stringify({ initialized: true, config, probe, scaffold }, null, 2));
}

async function doctor(): Promise<void> {
  const probes = await Promise.all(getRuntimeAdapters().map((adapter) => adapter.probe()));
  console.log(JSON.stringify({ runtimes: probes }, null, 2));
  if (!probes.some((probe) => probe.available)) process.exitCode = 1;
}

async function runtime(root: string, args: string[]): Promise<void> {
  if (args[0] === "show") {
    console.log(JSON.stringify(await loadConfig(root), null, 2));
    return;
  }
  if (args[0] !== "set" || !args[1] || !isRuntimeName(args[1])) {
    throw new Error("Usage: team runtime set <claude|codex|gemini>");
  }
  const adapter = getRuntimeAdapter(args[1]);
  const probe = await adapter.probe();
  if (!probe.available) throw new Error(`${args[1]} is not available: ${probe.error}`);
  console.log(JSON.stringify({ config: await setSelectedRuntime(root, args[1]), probe }, null, 2));
}

async function run(root: string, args: string[]): Promise<void> {
  const prompt = valueAfter(args, "--prompt");
  if (!prompt) throw new Error("--prompt is required");
  const modeValue = valueAfter(args, "--mode") ?? "read-only";
  if (modeValue !== "read-only" && modeValue !== "workspace-write") {
    throw new Error("--mode must be read-only or workspace-write");
  }
  const timeoutValue = Number(valueAfter(args, "--timeout-ms") ?? "300000");
  if (!Number.isSafeInteger(timeoutValue) || timeoutValue < 1_000) throw new Error("--timeout-ms must be at least 1000");

  const config = await loadConfig(root);
  const adapter = getRuntimeAdapter(config.runtime);
  const store = new JsonlEventStore(path.join(stateDirectory(root), "events"));
  const result = await adapter.run(
    { prompt, cwd: root, mode: modeValue as RuntimeMode, timeoutMs: timeoutValue },
    (event) => store.append(event),
  );
  console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  process.exitCode = result.exitCode;
}

async function listAgents(root: string): Promise<void> {
  const registry = await AgentRegistry.load(root);
  console.log(JSON.stringify({
    agents: registry.list().map(({ id, name, description, context }) => ({ id, name, description, context })),
  }, null, 2));
}

async function ask(root: string, args: string[]): Promise<void> {
  const [agentValue, request] = args;
  if (!agentValue || !isAgentId(agentValue)) throw new Error("Unknown or missing agent id");
  if (!request || request.startsWith("--")) throw new Error("Agent request is required as the second argument");

  const registry = await AgentRegistry.load(root);
  const agent = registry.get(agentValue);
  const context = await loadAgentContext(root, agent);
  const prompt = compileAgentPrompt(agent, request, context);
  if (args.includes("--dry-run")) {
    console.log(prompt);
    return;
  }

  if (args.includes("--mode")) throw new Error("team ask is read-only until scoped artifact writes are enabled");
  const config = await loadConfig(root);
  const adapter = getRuntimeAdapter(config.runtime);
  const store = new JsonlEventStore(path.join(stateDirectory(root), "events"));
  const result = await adapter.run(
    {
      prompt,
      cwd: root,
      mode: "read-only",
      timeoutMs: 300_000,
      outputSchema: { schema: agent.outputSchema, path: path.resolve(root, agent.outputs.schema) },
    },
    (event) => store.append(event),
  );
  console.log(JSON.stringify(parseAgentRuntimeResult(result), null, 2));
  if (result.stderr.trim()) console.error(result.stderr.trim());
}

async function bootstrapStatus(root: string, args: string[]): Promise<void> {
  if (args[0] !== "status") throw new Error("Usage: team bootstrap status");
  console.log(JSON.stringify(await readBootstrapStatus(root), null, 2));
}

function knowledgeReport(audit: Awaited<ReturnType<typeof auditKnowledge>>) {
  return {
    qualified: audit.qualified,
    checked_at: audit.checkedAt,
    active_modules: audit.activeModules,
    valid_sources: audit.validSources.map((source) => source.id),
    valid_cards: audit.validCards.map((card) => card.id),
    coverage_gaps: audit.coverageGaps,
    issues: audit.issues,
  };
}

async function knowledge(root: string, args: string[]): Promise<void> {
  if (args[0] === "check") {
    const audit = await auditKnowledge(root);
    console.log(JSON.stringify(knowledgeReport(audit), null, 2));
    if (!audit.qualified) process.exitCode = 1;
    return;
  }
  if (args[0] === "compile") {
    const result = await compileKnowledge(root);
    console.log(JSON.stringify({ ...knowledgeReport(result.audit), written: result.written }, null, 2));
    if (!result.audit.qualified) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: team knowledge <check|compile>");
}

async function withTaskStore<T>(root: string, operation: (store: TaskStore) => T | Promise<T>): Promise<T> {
  const store = await TaskStore.open(path.join(stateDirectory(root), "state.db"));
  try {
    return await operation(store);
  } finally {
    store.close();
  }
}

async function task(root: string, args: string[]): Promise<void> {
  if (args[0] === "create") {
    const owner = valueAfter(args, "--owner");
    const objective = valueAfter(args, "--objective");
    const why = valueAfter(args, "--why");
    if (!owner || !isAgentId(owner) || !objective || !why) {
      throw new Error("Usage: team task create --owner <agent-id> --objective <text> --why <text>");
    }
    const created = await withTaskStore(root, (store) => store.createTask({
      owner_agent: owner,
      objective,
      why,
      inputs: [],
      scope: { writable_paths: valuesAfter(args, "--write"), forbidden_actions: valuesAfter(args, "--forbid") },
      acceptance: [],
      checks: [],
      risk_flags: [],
      approval: { required_for: [] },
    }));
    console.log(JSON.stringify(created, null, 2));
    return;
  }
  if (args[0] === "show" && args[1]) {
    console.log(JSON.stringify(await withTaskStore(root, (store) => store.getTask(args[1] as string)), null, 2));
    return;
  }
  if (args[0] === "transition" && args[1] && args[2]) {
    const status = taskStatusSchema.parse(args[2]);
    console.log(JSON.stringify(await withTaskStore(root, (store) => store.transitionTask(args[1] as string, status)), null, 2));
    return;
  }
  throw new Error("Usage: team task <create|show|transition> ...");
}

async function handoff(root: string, args: string[]): Promise<void> {
  if (args[0] === "record") {
    const taskId = valueAfter(args, "--task");
    const agentId = valueAfter(args, "--agent");
    const source = valueAfter(args, "--from");
    if (!taskId || !agentId || !isAgentId(agentId) || !source) {
      throw new Error("Usage: team handoff record --task <task-id> --agent <agent-id> --from <json-file>");
    }
    const { readFile } = await import("node:fs/promises");
    const sourceReal = await resolveExistingProjectFile(root, source);
    const result = agentResultSchema.parse(JSON.parse(await readFile(sourceReal, "utf8")));
    console.log(JSON.stringify(await withTaskStore(root, (store) => store.recordHandoff(taskId, agentId, result)), null, 2));
    return;
  }
  if (args[0] === "list" && args[1]) {
    console.log(JSON.stringify({ handoffs: await withTaskStore(root, (store) => store.listHandoffs(args[1] as string)) }, null, 2));
    return;
  }
  throw new Error("Usage: team handoff <record|list> ...");
}

async function workflow(root: string, args: string[]): Promise<void> {
  if (args[0] === "inspect" && args[1]) {
    console.log(JSON.stringify(await loadWorkflow(root, args[1]), null, 2));
    return;
  }
  if (args[0] === "list") {
    const runs = await withTaskStore(root, (store) => store.listWorkflowRuns(valueAfter(args, "--task")));
    console.log(JSON.stringify({ runs }, null, 2));
    return;
  }
  if (args[0] === "show" && args[1]) {
    console.log(JSON.stringify(await withTaskStore(root, (store) => store.getWorkflowRun(args[1] as string)), null, 2));
    return;
  }
  const timeoutMs = Number(valueAfter(args, "--timeout-ms") ?? "300000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("--timeout-ms must be at least 1000");
  if (args[0] === "run" && args[1]) {
    const taskId = valueAfter(args, "--task");
    if (!taskId) throw new Error("--task is required");
    const definition = await loadWorkflow(root, args[1]);
    const runner = await createRuntimeWorkflowRunner(root, timeoutMs);
    const result = await withTaskStore(root, (store) => executeWorkflow(
      definition,
      store,
      taskId,
      runner,
      ({ runId, step }) => requestWorkflowApproval(root, store, runId, step.id, step.action, step.artifact).then(() => undefined),
    ));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args[0] === "resume" && args[1]) {
    const runId = args[1];
    const run = await withTaskStore(root, (store) => store.getWorkflowRun(runId));
    const definition = await loadWorkflow(root, run.workflow_id);
    const runner = await createRuntimeWorkflowRunner(root, timeoutMs);
    const result = await withTaskStore(root, (store) => resumeWorkflow(
      definition,
      store,
      runId,
      runner,
      ({ step }) => requestWorkflowApproval(root, store, runId, step.id, step.action, step.artifact).then(() => undefined),
    ));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error("Usage: team workflow <inspect|list|show|run|resume> ...");
}

async function inbox(root: string): Promise<void> {
  console.log(JSON.stringify({ approvals: await withTaskStore(root, (store) => store.listPendingApprovals()) }, null, 2));
}

async function approval(root: string, args: string[]): Promise<void> {
  if (args[0] === "request") {
    const taskId = valueAfter(args, "--task");
    const action = valueAfter(args, "--action");
    const artifact = valueAfter(args, "--artifact");
    if (!taskId || !action || !artifact) throw new Error("Usage: team approval request --task <task-id> --action <name> --artifact <project-file>");
    const created = await withTaskStore(root, (store) => requestApproval(root, store, taskId, action, artifact));
    console.log(JSON.stringify(created, null, 2));
    return;
  }
  if (args[0] === "decide" && args[1] && args[2]) {
    const decision = approvalDecisionSchema.parse(args[2]);
    const reason = valueAfter(args, "--reason");
    if (!reason) throw new Error("--reason is required");
    const updated = await withTaskStore(root, (store) => decideApproval(root, store, args[1] as string, decision, reason));
    console.log(JSON.stringify(updated, null, 2));
    return;
  }
  throw new Error("Usage: team approval <request|decide> ...");
}

async function worktree(root: string, args: string[]): Promise<void> {
  if (args[0] === "create" && args[1]) {
    console.log(JSON.stringify(await createEngineeringWorktree(root, args[1], valueAfter(args, "--base") ?? "HEAD"), null, 2));
    return;
  }
  if (args[0] === "inspect" && args[1]) {
    const baseCommit = valueAfter(args, "--base-commit");
    if (!baseCommit) throw new Error("--base-commit is required");
    const taskId = args[1];
    if (!/^TASK-[A-Z0-9-]+$/.test(taskId)) throw new Error(`Invalid task id for worktree: ${taskId}`);
    const slug = taskId.toLowerCase();
    console.log(JSON.stringify(await collectWorktreeEvidence(root, {
      taskId,
      branch: `agent-team/${slug}`,
      path: path.join(root, ".agent-team", "worktrees", slug),
      baseCommit,
    }), null, 2));
    return;
  }
  throw new Error("Usage: team worktree <create|inspect> ...");
}

function risk(args: string[]): void {
  if (args[0] !== "classify" || args.length < 2) throw new Error("Usage: team risk classify <path-or-label>...");
  console.log(JSON.stringify({ risk_flags: deriveRiskFlags(args.slice(1)) }, null, 2));
}

function finance(args: string[]): void {
  if (args[0] !== "runway") throw new Error("Usage: team finance runway --cash <number> --revenue <number> --expenses <number>");
  const availableCash = Number(valueAfter(args, "--cash"));
  const monthlyRevenue = Number(valueAfter(args, "--revenue"));
  const monthlyExpenses = Number(valueAfter(args, "--expenses"));
  console.log(JSON.stringify(calculateRunway({ availableCash, monthlyRevenue, monthlyExpenses }), null, 2));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  if (command === "init") await init(root, args);
  else if (command === "doctor") await doctor();
  else if (command === "runtime") await runtime(root, args);
  else if (command === "agents") await listAgents(root);
  else if (command === "ask") await ask(root, args);
  else if (command === "bootstrap") await bootstrapStatus(root, args);
  else if (command === "knowledge") await knowledge(root, args);
  else if (command === "task") await task(root, args);
  else if (command === "handoff") await handoff(root, args);
  else if (command === "workflow") await workflow(root, args);
  else if (command === "inbox") await inbox(root);
  else if (command === "approval") await approval(root, args);
  else if (command === "worktree") await worktree(root, args);
  else if (command === "risk") risk(args);
  else if (command === "finance") finance(args);
  else if (command === "run") await run(root, args);
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
