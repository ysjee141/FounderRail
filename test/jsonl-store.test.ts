import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonlEventStore } from "../src/events/jsonl-store.js";
import type { RuntimeEvent } from "../src/runtime/types.js";

test("appends normalized runtime events as JSONL", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-team-events-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonlEventStore(directory);
  const event: RuntimeEvent = {
    runId: "run-1",
    sequence: 0,
    timestamp: "2026-11-13T00:00:00.000Z",
    runtime: "codex",
    type: "run.started",
    payload: { mode: "read-only" },
  };

  await store.append(event);
  await store.append({ ...event, sequence: 1, type: "run.completed" });
  const lines = (await readFile(path.join(directory, "run-1.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), event);
});
