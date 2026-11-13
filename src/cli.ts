#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  if (command === "init") await init(root, args);
  else if (command === "doctor") await doctor();
  else if (command === "run") await run(root, args);
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
