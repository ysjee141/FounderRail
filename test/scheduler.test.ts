import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSchedules } from "../src/schedules/loader.js";
import { dueSlot, tickSchedules } from "../src/schedules/tick.js";
import { TaskStore } from "../src/store/task-store.js";

test("computes weekly and monthly slots in the declared timezone", async () => {
  const schedules = await loadSchedules(process.cwd());
  const weekly = schedules.find((schedule) => schedule.id === "weekly-operations");
  const monthly = schedules.find((schedule) => schedule.id === "monthly-close");
  assert.ok(weekly && monthly);

  assert.deepEqual(dueSlot(weekly, new Date("2026-11-09T00:05:00.000Z")), {
    scheduleId: "weekly-operations",
    slot: "2026-11-09T09:00@Asia/Seoul",
    scheduledAt: "2026-11-09T00:00:00.000Z",
  });
  assert.equal(dueSlot(weekly, new Date("2026-11-08T23:00:00.000Z")), undefined);
  assert.deepEqual(dueSlot(monthly, new Date("2026-11-01T00:05:00.000Z")), {
    scheduleId: "monthly-close",
    slot: "2026-11-01T09:00@Asia/Seoul",
    scheduledAt: "2026-11-01T00:00:00.000Z",
  });
});

test("creates one idempotent draft task for each schedule slot", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-scheduler-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await TaskStore.open(path.join(root, "state.db"));
  t.after(() => store.close());
  const schedules = await loadSchedules(process.cwd());
  const now = new Date("2026-11-09T00:05:00.000Z");

  const first = tickSchedules(store, schedules, now);
  const second = tickSchedules(store, schedules, now);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.created, true);
  assert.equal(first[0]?.task.status, "draft");
  assert.equal(second[0]?.created, false);
  assert.equal(second[0]?.task.id, first[0]?.task.id);
  assert.equal(store.listScheduleFirings().length, 1);
});
