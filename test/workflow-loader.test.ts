import assert from "node:assert/strict";
import test from "node:test";
import { InvalidWorkflowError, loadWorkflow, validateWorkflow } from "../src/workflows/loader.js";

test("loads and validates the idea validation workflow", async () => {
  const workflow = await loadWorkflow(process.cwd(), "idea-validation");
  assert.equal(workflow.steps.length, 3);
  assert.deepEqual(workflow.steps[2]?.requires, ["product-discovery", "finance-review"]);
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
