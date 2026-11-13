import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readBootstrapStatus, selectKnowledgeModules, type BusinessProductProfile } from "../src/knowledge/bootstrap.js";
import { scaffoldProject } from "../src/context/scaffold.js";

test("reports undecided bootstrap fields from the default profile", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await scaffoldProject(root);
  const status = await readBootstrapStatus(root);
  assert.equal(status.selection.ready, false);
  assert.ok(status.selection.undecided.includes("product.form"));
  assert.ok(status.selection.baselineModules.includes("secure-development"));
  assert.ok(status.selection.overlays.includes("jurisdiction/kr"));
});

test("selects SaaS, subscription and AI modules from a completed profile", () => {
  const profile: BusinessProductProfile = {
    version: 1,
    business: { home_jurisdiction: "KR", entity_status: "individual", target_markets: ["KR"], customer_type: "B2B", revenue_model: ["subscription"] },
    product: { form: "web_saas", distribution: ["web"], stage: "idea", has_ai_features: true, allows_user_content: false },
    data: { categories: ["account"], sensitive_categories: [], minors_possible: false, storage_regions: ["KR"] },
    technology: { cloud: "undecided-provider", auth: "managed", payment_provider: "managed", analytics: "none" },
    operations: { availability_target: "best_effort", recovery_target: "24h", support_channel: "email" },
  };
  const selection = selectKnowledgeModules(profile);
  assert.equal(selection.ready, true);
  assert.deepEqual(selection.conditionalModules, ["ai-feature-safety", "saas", "subscription-commerce"]);
});
