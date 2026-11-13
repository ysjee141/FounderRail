import assert from "node:assert/strict";
import test from "node:test";
import { runInvocation } from "../src/runtime/process.js";
import type { RuntimeEvent, RuntimeRunRequest } from "../src/runtime/types.js";

test("serializes streamed events before the completion event", async () => {
  const request: RuntimeRunRequest = {
    prompt: "unused",
    cwd: process.cwd(),
    mode: "read-only",
    timeoutMs: 10_000,
  };
  const events: RuntimeEvent[] = [];
  const result = await runInvocation(
    "codex",
    {
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify({n: 1})); console.log(JSON.stringify({n: 2}))"],
    },
    request,
    async (event) => {
      await new Promise((resolve) => setTimeout(resolve, event.type === "runtime.stdout" ? 2 : 0));
      events.push(event);
    },
  );

  assert.equal(result.exitCode, 0);
  assert.deepEqual(events.map((event) => event.type), [
    "run.started",
    "runtime.stdout",
    "runtime.stdout",
    "run.completed",
  ]);
  assert.deepEqual(events.map((event) => event.sequence), [0, 1, 2, 3]);
});
