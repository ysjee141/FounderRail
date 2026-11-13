import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  assert.equal(result.termination, "completed");
  assert.deepEqual(events.map((event) => event.type), [
    "run.started",
    "runtime.stdout",
    "runtime.stdout",
    "run.completed",
  ]);
  assert.deepEqual(events.map((event) => event.sequence), [0, 1, 2, 3]);
});

test("times out the whole process group without leaving a child writer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const heartbeat = path.join(root, "heartbeat.txt");
  const writer = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),20)`;
  const parent = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  const result = await runInvocation("codex", {
    command: process.execPath,
    args: ["-e", parent],
  }, {
    prompt: "unused",
    cwd: root,
    mode: "read-only",
    timeoutMs: 150,
  });

  assert.equal(result.exitCode, 124);
  assert.equal(result.termination, "timed_out");
  const before = (await readFile(heartbeat, "utf8")).length;
  await new Promise((resolve) => setTimeout(resolve, 150));
  const after = (await readFile(heartbeat, "utf8")).length;
  assert.equal(after, before);
});

test("supports explicit cancellation with AbortSignal", async () => {
  const controller = new AbortController();
  const cancellation = setTimeout(() => controller.abort(), 50);
  const result = await runInvocation("claude", {
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
  }, {
    prompt: "unused",
    cwd: process.cwd(),
    mode: "read-only",
    timeoutMs: 10_000,
    signal: controller.signal,
  });
  clearTimeout(cancellation);
  assert.equal(result.exitCode, 130);
  assert.equal(result.termination, "aborted");
});
