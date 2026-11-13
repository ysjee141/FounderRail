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
import { TaskStore } from "./store/task-store.js";
import { agentResultSchema, taskStatusSchema } from "./tasks/contracts.js";
import { loadWorkflow } from "./workflows/loader.js";
import { getRuntimeAdapter, getRuntimeAdapters } from "./runtime/registry.js";
import type { RuntimeMode } from "./runtime/types.js";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
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
  team task create --owner <agent-id> --objective <text> --why <text>
  team task show <task-id>
  team task transition <task-id> <status>
  team handoff record --task <task-id> --agent <agent-id> --from <json-file>
  team handoff list <task-id>
  team workflow inspect <workflow-id>
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
    { prompt, cwd: root, mode: "read-only", timeoutMs: 300_000 },
    (event) => store.append(event),
  );
  console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  process.exitCode = result.exitCode;
}

async function bootstrapStatus(root: string, args: string[]): Promise<void> {
  if (args[0] !== "status") throw new Error("Usage: team bootstrap status");
  console.log(JSON.stringify(await readBootstrapStatus(root), null, 2));
}

async function withTaskStore<T>(root: string, operation: (store: TaskStore) => T): Promise<T> {
  const store = await TaskStore.open(path.join(stateDirectory(root), "state.db"));
  try {
    return operation(store);
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
      scope: { writable_paths: [], forbidden_actions: [] },
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
    const { readFile, realpath } = await import("node:fs/promises");
    const rootReal = await realpath(root);
    const sourceReal = await realpath(path.resolve(root, source));
    const relativeSource = path.relative(rootReal, sourceReal);
    if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
      throw new Error("Handoff source must be inside the project");
    }
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
  if (args[0] !== "inspect" || !args[1]) throw new Error("Usage: team workflow inspect <workflow-id>");
  console.log(JSON.stringify(await loadWorkflow(root, args[1]), null, 2));
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
  else if (command === "task") await task(root, args);
  else if (command === "handoff") await handoff(root, args);
  else if (command === "workflow") await workflow(root, args);
  else if (command === "run") await run(root, args);
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
