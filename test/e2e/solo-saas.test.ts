import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentRegistry } from "../../src/agents/registry.js";
import { decideApproval, requestWorkflowApproval } from "../../src/approvals/service.js";
import { scaffoldProject } from "../../src/context/scaffold.js";
import { writeScopedArtifact } from "../../src/context/scoped-writer.js";
import { TaskStore } from "../../src/store/task-store.js";
import { executeWorkflow } from "../../src/workflows/executor.js";
import { loadWorkflow } from "../../src/workflows/loader.js";

test("feature task reaches human-approved completion using structured handoffs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-e2e-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await scaffoldProject(root);
  await mkdir(path.join(root, ".agent-team"), { recursive: true });
  const store = await TaskStore.open(path.join(root, ".agent-team", "state.db"));
  t.after(() => store.close());
  const registry = await AgentRegistry.load(process.cwd());

  const task = store.createTask({
    owner_agent: "product-growth",
    objective: "Add managed authentication",
    why: "Allow the first B2B customer to use the SaaS",
    inputs: ["examples/solo-saas/idea.md"],
    scope: { writable_paths: ["work/**", "company/risk/**"], forbidden_actions: ["production.deploy"] },
    acceptance: ["Authentication risk is reviewed", "Release needs human approval"],
    checks: ["fake:test"],
    risk_flags: ["authentication"],
    approval: { required_for: ["release"] },
  });
  store.transitionTask(task.id, "ready");

  const workflow = await loadWorkflow(process.cwd(), "feature-delivery");
  const executedAgents: string[] = [];
  const execution = await executeWorkflow(workflow, store, task.id, async ({ step }) => {
    executedAgents.push(step.agent);
    if (step.agent === "product-growth") {
      await writeScopedArtifact(root, registry.get(step.agent), `work/specs/${task.id}.md`, "# Auth spec\n\nManaged authentication.\n");
    } else if (step.agent === "engineering") {
      await writeScopedArtifact(root, registry.get(step.agent), `work/releases/${task.id}.md`, "# Release candidate\n\nTests: fake:test passed.\nRollback: disable feature flag.\n");
    } else if (step.agent === "risk-quality") {
      await writeScopedArtifact(root, registry.get(step.agent), `work/risk-reviews/${task.id}.md`, "# Risk review\n\nAuthentication review completed.\n");
    } else if (step.agent === "founder-office") {
      await writeScopedArtifact(root, registry.get(step.agent), `company/decisions/${task.id}.md`, "# Release decision\n\nAwaiting human approval.\n");
    }
    return {
      status: "completed",
      summary: `${step.id} completed by fake runtime`,
      artifacts: [],
      evidence: [{ claim: `${step.id} executed`, source: "fake-runtime" }],
      decisions: [],
      assumptions: [],
      risks: [],
      requested_next_agent: null,
    };
  }, ({ runId, step }) => requestWorkflowApproval(
    root,
    store,
    runId,
    step.id,
    step.action,
    step.artifact,
  ).then(() => undefined));

  assert.equal(execution.status, "waiting_approval");
  assert.deepEqual(executedAgents, ["product-growth", "engineering", "risk-quality", "founder-office"]);
  assert.equal(store.getTask(task.id).status, "waiting_approval");
  assert.equal(store.listHandoffs(task.id).length, 4);

  const approval = execution.steps.find((step) => step.stepId === "release-approval")?.approval;
  assert.ok(approval);
  await decideApproval(root, store, approval.id, "approve", "Fake E2E evidence verified");
  assert.equal(store.getTask(task.id).status, "completed");
  assert.equal(store.getWorkflowRun(execution.runId).status, "completed");
});
