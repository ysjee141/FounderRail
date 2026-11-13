import assert from "node:assert/strict";
import test from "node:test";
import { agentResultSchema, createTaskContract } from "../src/tasks/contracts.js";

test("creates a complete task contract with stable timestamps", () => {
  const task = createTaskContract({
    owner_agent: "engineering",
    objective: "Implement scoped writes",
    why: "Prevent cross-agent document changes",
    inputs: ["work/specs/scoped-writes.md"],
    scope: { writable_paths: ["src/**"], forbidden_actions: ["production.deploy"] },
    acceptance: ["Traversal is rejected"],
    checks: ["npm test"],
    risk_flags: ["authorization"],
    approval: { required_for: ["merge"] },
  }, new Date("2026-11-13T00:00:00.000Z"));
  assert.match(task.id, /^TASK-/);
  assert.equal(task.status, "draft");
  assert.equal(task.created_at, "2026-11-13T00:00:00.000Z");
});

test("rejects an incomplete agent result", () => {
  assert.throws(() => agentResultSchema.parse({ status: "completed", summary: "No evidence fields" }));
});

test("rejects unsafe or unsupported writable path scopes", () => {
  const base = {
    owner_agent: "engineering" as const,
    objective: "Scoped change",
    why: "Prevent worktree escape",
    inputs: [],
    acceptance: [],
    checks: [],
    risk_flags: [],
    approval: { required_for: [] },
  };
  assert.throws(() => createTaskContract({
    ...base,
    scope: { writable_paths: ["../outside/**"], forbidden_actions: [] },
  }));
  assert.throws(() => createTaskContract({
    ...base,
    scope: { writable_paths: ["src/*.ts"], forbidden_actions: [] },
  }));
});
