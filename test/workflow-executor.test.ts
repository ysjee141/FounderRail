import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../src/store/task-store.js";
import { executeWorkflow, resumeWorkflow } from "../src/workflows/executor.js";
import { loadWorkflow, validateWorkflow } from "../src/workflows/loader.js";

async function createReadyTask(t: import("node:test").TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-workflow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await TaskStore.open(path.join(root, "state.db"));
  t.after(() => store.close());
  const task = store.createTask({
    owner_agent: "product-growth",
    objective: "Validate an idea",
    why: "Avoid building before evidence",
    inputs: [],
    scope: { writable_paths: [], forbidden_actions: [] },
    acceptance: ["Decision options are explicit"],
    checks: [],
    risk_flags: [],
    approval: { required_for: ["experiment"] },
  });
  store.transitionTask(task.id, "ready");
  return { store, task };
}

const validResult = (summary: string) => ({
  status: "completed" as const,
  summary,
  artifacts: [],
  evidence: [{ claim: "fake evidence", source: "fake-runtime" }],
  decisions: [],
  assumptions: [],
  risks: [],
  requested_next_agent: null,
});

test("runs idea validation in dependency order and passes only handoffs", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = await loadWorkflow(process.cwd(), "idea-validation");
  const calls: Array<{ step: string; prior: number }> = [];
  const result = await executeWorkflow(workflow, store, task.id, async ({ step, priorHandoffs }) => {
    calls.push({ step: step.id, prior: priorHandoffs.length });
    return validResult(step.id);
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [
    { step: "product-discovery", prior: 0 },
    { step: "finance-review", prior: 1 },
    { step: "founder-synthesis", prior: 2 },
  ]);
  assert.equal(store.listHandoffs(task.id).length, 3);
  assert.equal(store.getTask(task.id).status, "in_review");
});

test("retries once and fails the task when the runner keeps failing", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "failing",
    name: "Failing",
    description: "Retry test",
    steps: [{ id: "fail", agent: "engineering", prompt: "fail", requires: [], when: "always", retry: 1 }],
  });
  let calls = 0;
  const result = await executeWorkflow(workflow, store, task.id, async () => {
    calls += 1;
    throw new Error("runtime unavailable");
  });
  assert.equal(calls, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.steps[0]?.attempts, 2);
  assert.equal(store.getTask(task.id).status, "failed");
});

test("skips a conditional risk step when the task has no risk flags", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "conditional",
    name: "Conditional",
    description: "Condition test",
    steps: [{ id: "risk", agent: "risk-quality", prompt: "review", requires: [], when: "risk_flags_present", retry: 1 }],
  });
  const result = await executeWorkflow(workflow, store, task.id, async () => validResult("should not run"));
  assert.equal(result.steps[0]?.status, "skipped");
  assert.equal(store.listHandoffs(task.id).length, 0);
});

test("schedules an out-of-order YAML definition by dependencies", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "out-of-order",
    name: "Out of order",
    description: "Dependency scheduling",
    steps: [
      { id: "second", agent: "founder-office", prompt: "second", requires: ["first"], when: "always", retry: 0 },
      { id: "first", agent: "product-growth", prompt: "first", requires: [], when: "always", retry: 0 },
    ],
  });
  const calls: string[] = [];
  const result = await executeWorkflow(workflow, store, task.id, async ({ step }) => {
    calls.push(step.id);
    return validResult(step.id);
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["first", "second"]);
});

test("stops the workflow and blocks the task when an agent needs input", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "needs-input",
    name: "Needs input",
    description: "Block test",
    steps: [
      { id: "question", agent: "finance-ops", prompt: "question", requires: [], when: "always", retry: 0 },
      { id: "later", agent: "founder-office", prompt: "later", requires: ["question"], when: "always", retry: 0 },
    ],
  });
  let calls = 0;
  const result = await executeWorkflow(workflow, store, task.id, async () => {
    calls += 1;
    return { ...validResult("Need source data"), status: "needs_input" as const };
  });
  assert.equal(result.status, "blocked");
  assert.equal(calls, 1);
  assert.equal(store.getTask(task.id).status, "blocked");
});

test("persists a failed run and resumes without rerunning completed steps", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "resumable",
    name: "Resumable",
    description: "Persistent resume test",
    steps: [
      { id: "first", agent: "product-growth", prompt: "first", requires: [], when: "always", retry: 0 },
      { id: "second", agent: "finance-ops", prompt: "second", requires: ["first"], when: "always", retry: 0 },
      { id: "third", agent: "founder-office", prompt: "third", requires: ["second"], when: "always", retry: 0 },
    ],
  });
  const firstCalls: string[] = [];
  const failed = await executeWorkflow(workflow, store, task.id, async ({ step }) => {
    firstCalls.push(step.id);
    if (step.id === "second") throw new Error("temporary runtime failure");
    return validResult(step.id);
  });

  assert.equal(failed.status, "failed");
  assert.deepEqual(firstCalls, ["first", "second"]);
  assert.equal(store.getWorkflowRun(failed.runId).steps[0]?.status, "completed");

  const resumedCalls: string[] = [];
  const resumed = await resumeWorkflow(workflow, store, failed.runId, async ({ step, priorHandoffs }) => {
    resumedCalls.push(step.id);
    if (step.id === "second") assert.equal(priorHandoffs.length, 1);
    return validResult(step.id);
  });

  assert.equal(resumed.status, "completed");
  assert.deepEqual(resumedCalls, ["second", "third"]);
  assert.equal(resumed.runId, failed.runId);
  assert.equal(store.listHandoffs(task.id).length, 3);
  assert.equal(store.getTask(task.id).status, "in_review");
});

test("refuses resume when the workflow definition changed", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "digest-bound",
    name: "Digest bound",
    description: "Original definition",
    steps: [{ id: "only", agent: "engineering", prompt: "original", requires: [], when: "always", retry: 0 }],
  });
  const failed = await executeWorkflow(workflow, store, task.id, async () => {
    throw new Error("stop");
  });
  const changed = validateWorkflow({
    ...workflow,
    steps: [{ ...workflow.steps[0], prompt: "changed after start" }],
  });
  await assert.rejects(
    () => resumeWorkflow(changed, store, failed.runId, async () => validResult("unexpected")),
    /changed after run/,
  );
});

test("pauses at an approval step and resumes after an artifact-bound decision", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "approval-resume",
    name: "Approval resume",
    description: "Approval checkpoint test",
    steps: [
      { id: "prepare", agent: "engineering", prompt: "prepare", requires: [], when: "always", retry: 0 },
      {
        id: "human-check",
        type: "approval",
        action: "release",
        artifact: "work/releases/candidate.md",
        requires: ["prepare"],
        when: "always",
      },
      { id: "after", agent: "founder-office", prompt: "after", requires: ["human-check"], when: "always", retry: 0 },
    ],
  });
  const calls: string[] = [];
  let approvalId = "";
  const waiting = await executeWorkflow(
    workflow,
    store,
    task.id,
    async ({ step }) => {
      calls.push(step.id);
      return validResult(step.id);
    },
    async ({ runId, step }) => {
      const requested = store.requestWorkflowStepApproval(
        runId,
        step.id,
        step.action,
        step.artifact,
        "a".repeat(64),
      );
      approvalId = requested.approval.id;
    },
  );

  assert.equal(waiting.status, "waiting_approval");
  assert.deepEqual(calls, ["prepare"]);
  assert.equal(store.getTask(task.id).status, "waiting_approval");
  store.decideApproval(approvalId, "approve", "evidence checked");
  assert.equal(store.getTask(task.id).status, "running");

  const resumed = await resumeWorkflow(workflow, store, waiting.runId, async ({ step }) => {
    calls.push(step.id);
    return validResult(step.id);
  });
  assert.equal(resumed.status, "completed");
  assert.deepEqual(calls, ["prepare", "after"]);
  assert.equal(store.getTask(task.id).status, "in_review");
});

test("requesting approval changes creates a fresh checkpoint on resume", async (t) => {
  const { store, task } = await createReadyTask(t);
  const workflow = validateWorkflow({
    id: "approval-changes",
    name: "Approval changes",
    description: "Reapproval test",
    steps: [{
      id: "check",
      type: "approval",
      action: "release",
      artifact: "company/release-checklist.md",
      requires: [],
      when: "always",
    }],
  });
  const approvals: string[] = [];
  const request = async ({ runId, step }: Parameters<NonNullable<Parameters<typeof executeWorkflow>[4]>>[0]) => {
    const created = store.requestWorkflowStepApproval(
      runId,
      step.id,
      step.action,
      step.artifact,
      (approvals.length === 0 ? "a" : "b").repeat(64),
    );
    approvals.push(created.approval.id);
  };

  const waiting = await executeWorkflow(workflow, store, task.id, async () => validResult("unused"), request);
  const firstApproval = approvals[0];
  assert.ok(firstApproval);
  store.decideApproval(firstApproval, "request_changes", "update rollback evidence");
  assert.equal(store.getWorkflowRun(waiting.runId).status, "blocked");

  const waitingAgain = await resumeWorkflow(workflow, store, waiting.runId, async () => validResult("unused"), request);
  assert.equal(waitingAgain.status, "waiting_approval");
  assert.equal(approvals.length, 2);
  assert.notEqual(approvals[0], approvals[1]);
  const secondApproval = approvals[1];
  assert.ok(secondApproval);
  store.decideApproval(secondApproval, "approve", "updated evidence checked");
  assert.equal(store.getWorkflowRun(waiting.runId).status, "completed");
  assert.equal(store.getTask(task.id).status, "completed");
});
