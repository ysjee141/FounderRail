import assert from "node:assert/strict";
import test from "node:test";
import { InvalidWorkflowError, loadWorkflow, validateWorkflow } from "../src/workflows/loader.js";

test("loads and validates the idea validation workflow", async () => {
  const workflow = await loadWorkflow(process.cwd(), "idea-validation");
  assert.equal(workflow.steps.length, 3);
  assert.deepEqual(workflow.steps[2]?.requires, ["product-discovery", "finance-review"]);
});

test("loads a typed artifact-bound approval step", async () => {
  const workflow = await loadWorkflow(process.cwd(), "feature-delivery");
  const approval = workflow.steps.find((step) => step.type === "approval");
  assert.deepEqual(approval, {
    id: "release-approval",
    type: "approval",
    action: "release",
    artifact: "company/release-checklist.md",
    requires: ["scope-review"],
    when: "always",
  });
});

test("rejects unknown dependencies and cycles", () => {
  assert.throws(() => validateWorkflow({
    id: "broken",
    name: "Broken",
    description: "Unknown dependency",
    steps: [{ id: "one", agent: "engineering", prompt: "x", requires: ["missing"], when: "always", retry: 1 }],
  }), InvalidWorkflowError);
  assert.throws(() => validateWorkflow({
    id: "cycle",
    name: "Cycle",
    description: "Cycle",
    steps: [
      { id: "one", agent: "engineering", prompt: "x", requires: ["two"], when: "always", retry: 1 },
      { id: "two", agent: "engineering", prompt: "x", requires: ["one"], when: "always", retry: 1 },
    ],
  }), InvalidWorkflowError);
});

test("restricts engineering execution modes to the engineering agent", () => {
  assert.throws(() => validateWorkflow({
    id: "unsafe-mode",
    name: "Unsafe mode",
    description: "Non-engineering write attempt",
    steps: [{
      id: "write",
      agent: "product-growth",
      execution: "engineering-implement",
      prompt: "write code",
      requires: [],
      when: "always",
      retry: 0,
    }],
  }), /restricted to the engineering agent/);
});
