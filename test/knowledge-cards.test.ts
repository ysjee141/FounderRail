import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentRegistry } from "../src/agents/registry.js";
import { loadAgentContext } from "../src/context/loader.js";
import { scaffoldProject } from "../src/context/scaffold.js";
import { auditKnowledge, compileKnowledge, loadApprovedKnowledgeContext } from "../src/knowledge/cards.js";

async function fixture(t: import("node:test").TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-knowledge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await scaffoldProject(root);
  const snapshot = "Verified engineering baseline source snapshot.\n";
  const hash = createHash("sha256").update(snapshot).digest("hex");
  await writeFile(path.join(root, "knowledge", "sources", "snapshots", "baseline.txt"), snapshot);
  await writeFile(path.join(root, "knowledge", "sources", "manifest.yaml"), `version: 1
sources:
  - id: engineering-source
    title: Engineering Source
    authority: Standards Body
    url: https://example.com/engineering
    kind: standard
    module: engineering-baseline
    jurisdiction: global
    content_path: knowledge/sources/snapshots/baseline.txt
    sha256: ${hash}
    retrieved_at: 2026-11-01
    verified_at: 2026-11-02
    review_after: 2027-02-01
    status: verified
`);
  await writeFile(path.join(root, "knowledge", "catalog.yaml"), `version: 1
active_modules: [engineering-baseline]
`);
  await writeFile(path.join(root, "knowledge", "cards", "bounded-change.yaml"), `version: 1
id: bounded-change
title: Keep engineering changes bounded
module: engineering-baseline
claim: Changes should remain inside the explicitly approved scope.
action: Compare the changed-file list with the Task writable paths.
applies_when: An engineering Task modifies repository files.
does_not_apply_when: The workflow is read-only and creates no repository change.
source_ids: [engineering-source]
roles: [engineering, risk-quality]
verified_at: 2026-11-02
review_after: 2027-02-01
risk: high
professional_review: conditional
status: verified
`);
  return { root };
}

test("audits, compiles and injects only fresh verified cards", async (t) => {
  const { root } = await fixture(t);
  const now = new Date("2026-11-13T00:00:00.000Z");
  const audit = await auditKnowledge(root, now);
  assert.equal(audit.qualified, true);
  assert.deepEqual(audit.validCards.map((card) => card.id), ["bounded-change"]);

  const compiled = await compileKnowledge(root, now);
  assert.deepEqual(compiled.written, ["knowledge/compiled/bounded-change.md"]);
  assert.match(await readFile(path.join(root, compiled.written[0] as string), "utf8"), /Engineering Source/);

  const engineering = await loadApprovedKnowledgeContext(root, "engineering", now);
  const finance = await loadApprovedKnowledgeContext(root, "finance-ops", now);
  assert.equal(engineering.length, 1);
  assert.equal(finance.length, 0);

  const registry = await AgentRegistry.load(process.cwd());
  const context = await loadAgentContext(root, registry.get("engineering"));
  assert.ok(context.some((document) => document.path === "knowledge/compiled/bounded-change.md"));
});

test("fails freshness and hash gates without injecting the card", async (t) => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, "knowledge", "sources", "snapshots", "baseline.txt"), "tampered\n");
  const audit = await auditKnowledge(root, new Date("2026-11-13T00:00:00.000Z"));
  assert.equal(audit.qualified, false);
  assert.ok(audit.issues.some((item) => item.code === "invalid_source_snapshot"));
  assert.ok(audit.issues.some((item) => item.code === "invalid_card_sources"));
  assert.equal((await loadApprovedKnowledgeContext(root, "engineering", new Date("2026-11-13T00:00:00.000Z"))).length, 0);

  const stale = await auditKnowledge(root, new Date("2027-03-01T00:00:00.000Z"));
  assert.ok(stale.issues.some((item) => item.code === "stale_source"));
  assert.ok(stale.issues.some((item) => item.code === "stale_card"));
});
