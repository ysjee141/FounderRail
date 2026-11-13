import path from "node:path";
import process from "node:process";
import { compileAgentPrompt } from "../src/agents/prompt.js";
import { AgentRegistry } from "../src/agents/registry.js";
import { getRuntimeAdapter } from "../src/runtime/registry.js";
import { parseAgentRuntimeResult } from "../src/runtime/result-contract.js";
import { RUNTIME_NAMES, type RuntimeName } from "../src/runtime/types.js";

function requestedRuntimes(args: string[]): RuntimeName[] {
  const index = args.indexOf("--runtime");
  const value = index === -1 ? "all" : args[index + 1];
  if (value === "all") return [...RUNTIME_NAMES];
  if (value && RUNTIME_NAMES.includes(value as RuntimeName)) return [value as RuntimeName];
  throw new Error("--runtime must be claude, codex, gemini or all");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requireAll = args.includes("--require-all");
  const root = process.cwd();
  const agent = (await AgentRegistry.load(root)).get("founder-office");
  const prompt = compileAgentPrompt(
    agent,
    "Live contract probe. Do not use tools. Return a completed Agent Result whose summary is exactly 'live contract ok' and whose arrays are empty.",
  );
  const results: Array<Record<string, unknown>> = [];

  for (const runtime of requestedRuntimes(args)) {
    const adapter = getRuntimeAdapter(runtime);
    const probe = await adapter.probe();
    if (!probe.available) {
      results.push({ runtime, status: "skipped", reason: probe.error });
      if (requireAll) process.exitCode = 1;
      continue;
    }
    const run = await adapter.run({
      prompt,
      cwd: root,
      mode: "read-only",
      timeoutMs: 120_000,
      outputSchema: { schema: agent.outputSchema, path: path.resolve(root, agent.outputs.schema) },
    });
    if (run.exitCode !== 0) {
      const diagnostic = (run.stderr.trim() || run.stdout.trim()).slice(0, 2_000);
      throw new Error(`${runtime} live contract failed (${run.termination}, exit ${run.exitCode}): ${diagnostic}`);
    }
    const parsed = parseAgentRuntimeResult(run);
    if (parsed.summary !== "live contract ok") throw new Error(`${runtime} returned an unexpected probe summary`);
    results.push({
      runtime,
      status: "passed",
      version: probe.version,
      run_id: run.runId,
      duration_ms: Date.parse(run.finishedAt) - Date.parse(run.startedAt),
    });
  }

  console.log(JSON.stringify({ live_contracts: results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
