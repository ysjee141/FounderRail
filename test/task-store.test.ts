import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore, TaskNotFoundError } from "../src/store/task-store.js";
import { InvalidTaskTransitionError } from "../src/tasks/state-machine.js";
import { validateWorkflow } from "../src/workflows/loader.js";

async function openTemporaryStore(t: Parameters<typeof test>[1] extends (arg: infer T) => unknown ? T : never) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await TaskStore.open(path.join(root, "state.db"));
  t.after(() => store.close());
  return store;
}

const taskInput = {
  owner_agent: "engineering" as const,
  objective: "Build state store",
  why: "Persist task contracts",
  inputs: [],
  scope: { writable_paths: ["src/**"], forbidden_actions: [] },
  acceptance: ["State survives reopen"],
  checks: ["npm test"],
  risk_flags: [],
  approval: { required_for: ["merge"] },
};

test("persists tasks and enforces state transitions", async (t) => {
  const store = await openTemporaryStore(t);
  const task = store.createTask(taskInput);
  assert.equal(store.getTask(task.id).objective, taskInput.objective);
  assert.equal(store.transitionTask(task.id, "ready").status, "ready");
  assert.equal(store.transitionTask(task.id, "running").status, "running");
  assert.throws(() => store.transitionTask(task.id, "completed"), InvalidTaskTransitionError);
  assert.throws(() => store.getTask("TASK-MISSING"), TaskNotFoundError);
});

test("records validated immutable handoffs for an existing task", async (t) => {
  const store = await openTemporaryStore(t);
  const task = store.createTask(taskInput);
  const result = {
    status: "ready_for_review" as const,
    summary: "State store implemented",
    artifacts: ["commit:abc"],
    evidence: [{ claim: "Tests pass", source: "npm test" }],
    decisions: [],
    assumptions: [],
    risks: [],
    requested_next_agent: "risk-quality" as const,
  };
  const handoff = store.recordHandoff(task.id, "engineering", result);
  assert.deepEqual(store.listHandoffs(task.id), [handoff]);
  assert.throws(() => store.recordHandoff("TASK-MISSING", "engineering", result), TaskNotFoundError);
});

test("workflow run state survives closing and reopening SQLite", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-run-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "state.db");
  const first = await TaskStore.open(databasePath);
  const task = first.createTask(taskInput);
  first.transitionTask(task.id, "ready");
  const workflow = validateWorkflow({
    id: "persisted",
    name: "Persisted",
    description: "Persistence check",
    steps: [{ id: "one", agent: "engineering", prompt: "check", requires: [], when: "always", retry: 0 }],
  });
  const run = first.startWorkflowRun(workflow, task.id);
  first.startWorkflowStep(run.id, "one");
  first.close();

  const reopened = await TaskStore.open(databasePath);
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflowRun(run.id).steps[0]?.status, "running");
  assert.deepEqual(reopened.listWorkflowRuns(task.id).map((item) => item.id), [run.id]);
});
