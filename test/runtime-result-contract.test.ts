import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRuntimeFinalValue,
  parseAgentRuntimeResult,
  RuntimeContractError,
} from "../src/runtime/result-contract.js";
import type { RuntimeName, RuntimeResult } from "../src/runtime/types.js";

const resultValue = {
  status: "completed",
  summary: "검토 완료",
  artifacts: [],
  evidence: [{ claim: "테스트 통과", source: "npm test" }],
  decisions: [],
  assumptions: [],
  risks: [],
  requested_next_agent: null,
};

function runtimeResult(runtime: RuntimeName, stdout: string, exitCode = 0): RuntimeResult {
  return {
    runId: "run-1",
    runtime,
    exitCode,
    stdout,
    stderr: "",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    termination: exitCode === 0 ? "completed" : "failed",
  };
}

test("extracts Claude native structured output from its terminal result", () => {
  const stdout = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: resultValue }),
  ].join("\n");
  assert.deepEqual(parseAgentRuntimeResult(runtimeResult("claude", stdout)), resultValue);
});

test("extracts the last completed Codex agent message", () => {
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "draft" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(resultValue) } }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");
  assert.deepEqual(parseAgentRuntimeResult(runtimeResult("codex", stdout)), resultValue);
});

test("joins Gemini assistant chunks before validating the result", () => {
  const json = JSON.stringify(resultValue);
  const stdout = [
    JSON.stringify({ type: "init", session_id: "session-1" }),
    JSON.stringify({ type: "message", role: "user", content: "ignored" }),
    JSON.stringify({ type: "message", role: "assistant", content: json.slice(0, 40), delta: true }),
    JSON.stringify({ type: "message", role: "assistant", content: json.slice(40), delta: true }),
    JSON.stringify({ type: "result", status: "success", stats: {} }),
  ].join("\n");
  assert.deepEqual(parseAgentRuntimeResult(runtimeResult("gemini", stdout)), resultValue);
});

test("fails closed for malformed streams, failed processes and extra contract fields", () => {
  assert.throws(
    () => extractRuntimeFinalValue("codex", "not-json"),
    (error: unknown) => error instanceof RuntimeContractError && /invalid JSONL/.test(error.message),
  );
  assert.throws(
    () => parseAgentRuntimeResult(runtimeResult("codex", "", 2)),
    (error: unknown) => error instanceof RuntimeContractError && /exited with code 2/.test(error.message),
  );
  const extra = JSON.stringify({ ...resultValue, unexpected: true });
  const stdout = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: extra } });
  assert.throws(
    () => parseAgentRuntimeResult(runtimeResult("codex", stdout)),
    (error: unknown) => error instanceof RuntimeContractError && /violates Agent Result contract/.test(error.message),
  );
});
