import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ApprovalArtifactChangedError, decideApproval, requestApproval } from "../src/approvals/service.js";
import { TaskStore } from "../src/store/task-store.js";

async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "work", "releases"), { recursive: true });
  await writeFile(path.join(root, "work", "releases", "candidate.md"), "release v1\n");
  const store = await TaskStore.open(path.join(root, ".agent-team", "state.db"));
  t.after(() => store.close());
  const task = store.createTask({
    owner_agent: "engineering",
    objective: "Release candidate",
    why: "Ship validated value",
    inputs: [],
    scope: { writable_paths: [], forbidden_actions: ["production.deploy"] },
    acceptance: [],
    checks: [],
    risk_flags: [],
    approval: { required_for: ["release"] },
  });
  store.transitionTask(task.id, "ready");
  store.transitionTask(task.id, "running");
  store.transitionTask(task.id, "in_review");
  return { root, store, task, artifact: "work/releases/candidate.md" };
}

test("binds approval to an artifact hash and completes the approved task", async (t) => {
  const { root, store, task, artifact } = await fixture(t);
  const request = await requestApproval(root, store, task.id, "release", artifact);
  assert.equal(store.getTask(task.id).status, "waiting_approval");
  assert.deepEqual(store.listPendingApprovals(), [request]);

  const decided = await decideApproval(root, store, request.id, "approve", "검증 증거를 확인했다");
  assert.equal(decided.status, "approved");
  assert.equal(store.getTask(task.id).status, "completed");
  assert.deepEqual(store.listPendingApprovals(), []);
  await assert.rejects(() => decideApproval(root, store, request.id, "approve", "again"), /already decided/);
});

test("refuses approval when the reviewed artifact changed", async (t) => {
  const { root, store, task, artifact } = await fixture(t);
  const request = await requestApproval(root, store, task.id, "release", artifact);
  await writeFile(path.join(root, artifact), "release v2 changed after review\n");
  await assert.rejects(
    () => decideApproval(root, store, request.id, "approve", "approve stale content"),
    ApprovalArtifactChangedError,
  );
  assert.equal(store.getApproval(request.id).status, "pending");
  assert.equal(store.getTask(task.id).status, "waiting_approval");

  const returned = await decideApproval(root, store, request.id, "request_changes", "변경된 내용을 다시 검토한다");
  assert.equal(returned.status, "changes_requested");
  assert.equal(store.getTask(task.id).status, "running");
});

test("returns a task to running when changes are requested", async (t) => {
  const { root, store, task, artifact } = await fixture(t);
  const request = await requestApproval(root, store, task.id, "release", artifact);
  const decided = await decideApproval(root, store, request.id, "request_changes", "rollback 설명을 추가한다");
  assert.equal(decided.status, "changes_requested");
  assert.equal(store.getTask(task.id).status, "running");
});
