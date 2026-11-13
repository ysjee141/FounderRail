import assert from "node:assert/strict";
import test from "node:test";
import { calculateRunway } from "../src/finance/runway.js";
import { deriveRiskFlags } from "../src/risk/router.js";
import { loadWorkflow } from "../src/workflows/loader.js";

test("loads the core operating workflows", async () => {
  const ids = ["feature-delivery", "weekly-operations", "monthly-close", "incident"];
  const workflows = await Promise.all(ids.map((id) => loadWorkflow(process.cwd(), id)));
  assert.deepEqual(workflows.map((workflow) => workflow.id), ids);
  assert.equal(
    workflows.find((workflow) => workflow.id === "feature-delivery")?.steps.find((step) => step.id === "risk-review")?.when,
    "risk_flags_present",
  );
});

test("routes only risk-relevant changes to explicit flags", () => {
  assert.deepEqual(deriveRiskFlags(["src/auth/session.ts", "infra/terraform/main.tf", "docs/readme.md"]), [
    "authentication",
    "infrastructure",
  ]);
  assert.deepEqual(deriveRiskFlags(["src/ui/button.tsx", "docs/copy.md"]), []);
});

test("calculates runway deterministically and marks non-burning operations", () => {
  assert.deepEqual(calculateRunway({ availableCash: 12_000_000, monthlyRevenue: 1_000_000, monthlyExpenses: 3_000_000 }), {
    availableCash: 12_000_000,
    monthlyRevenue: 1_000_000,
    monthlyExpenses: 3_000_000,
    monthlyNetBurn: 2_000_000,
    runwayMonths: 6,
    sustainableAtCurrentRate: false,
  });
  assert.equal(calculateRunway({ availableCash: 1, monthlyRevenue: 2, monthlyExpenses: 1 }).runwayMonths, null);
  assert.throws(() => calculateRunway({ availableCash: Number.NaN, monthlyRevenue: 0, monthlyExpenses: 0 }));
});
