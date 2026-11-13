#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { compileAgentPrompt } from "./agents/prompt.js";
import { AgentRegistry, isAgentId } from "./agents/registry.js";
import { initializeConfig, isRuntimeName, loadConfig, stateDirectory } from "./config.js";
import { JsonlEventStore } from "./events/jsonl-store.js";
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
  team agents
  team ask <agent-id> <request> [--dry-run]
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
  console.log(JSON.stringify({ initialized: true, config, probe }, null, 2));
}

async function doctor(): Promise<void> {
  const probes = await Promise.all(getRuntimeAdapters().map((adapter) => adapter.probe()));
  console.log(JSON.stringify({ runtimes: probes }, null, 2));
  if (!probes.some((probe) => probe.available)) process.exitCode = 1;
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
  const prompt = compileAgentPrompt(registry.get(agentValue), request);
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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  if (command === "init") await init(root, args);
  else if (command === "doctor") await doctor();
  else if (command === "agents") await listAgents(root);
  else if (command === "ask") await ask(root, args);
  else if (command === "run") await run(root, args);
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
