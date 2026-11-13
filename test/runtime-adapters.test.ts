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
    "--permission-mode",
    "plan",
  ]);
});

test("Codex reads the prompt from stdin and uses a read-only sandbox", () => {
  const invocation = new CodexRuntimeAdapter().buildInvocation(request);
  assert.equal(invocation.stdin, request.prompt);
  assert.deepEqual(invocation.args, ["exec", "--json", "--sandbox", "read-only", "--ask-for-approval", "never", "-"]);
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
