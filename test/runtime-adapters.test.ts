import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeRuntimeAdapter } from "../src/runtime/adapters/claude.js";
import { CodexRuntimeAdapter } from "../src/runtime/adapters/codex.js";
import { GeminiRuntimeAdapter } from "../src/runtime/adapters/gemini.js";
import type { RuntimeRunRequest } from "../src/runtime/types.js";

const request: RuntimeRunRequest = {
  prompt: "Return a short status.",
  cwd: "/tmp/project",
  mode: "read-only",
  timeoutMs: 10_000,
};

test("Claude uses non-interactive streaming JSON in plan mode", () => {
  const invocation = new ClaudeRuntimeAdapter().buildInvocation(request);
  assert.equal(invocation.command, "claude");
  assert.deepEqual(invocation.args, [
    "-p",
    request.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--safe-mode",
    "--no-session-persistence",
    "--permission-prompts",
    "none",
    "--permission-mode",
    "plan",
  ]);
});

test("Codex reads the prompt from stdin and uses a read-only sandbox", () => {
  const invocation = new CodexRuntimeAdapter().buildInvocation(request);
  assert.equal(invocation.stdin, request.prompt);
  assert.deepEqual(invocation.args, [
    "--ask-for-approval",
    "never",
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--json",
    "--sandbox",
    "read-only",
    "-",
  ]);
});

test("Gemini uses headless streaming JSON in plan mode", () => {
  const invocation = new GeminiRuntimeAdapter().buildInvocation(request);
  assert.deepEqual(invocation.args, [
    "-p",
    request.prompt,
    "--output-format",
    "stream-json",
    "--approval-mode",
    "plan",
  ]);
});

test("Claude and Codex use their native structured-output schema flags", () => {
  const outputSchema = {
    schema: { type: "object", required: ["summary"] },
    path: "/tmp/project/schemas/agent-result.schema.json",
  };
  const claude = new ClaudeRuntimeAdapter().buildInvocation({ ...request, outputSchema });
  const codex = new CodexRuntimeAdapter().buildInvocation({ ...request, outputSchema });

  assert.deepEqual(claude.args.slice(-2), ["--json-schema", JSON.stringify(outputSchema.schema)]);
  assert.deepEqual(codex.args.slice(-3), ["--output-schema", outputSchema.path, "-"]);
});
