import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentRegistry } from "../src/agents/registry.js";
import { loadAgentContext } from "../src/context/loader.js";

test("loads only documents within an agent's read scope", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "company", "finance"), { recursive: true });
  await mkdir(path.join(root, "company", "risk"), { recursive: true });
  await writeFile(path.join(root, "company", "goals.md"), "goals");
  await writeFile(path.join(root, "company", "finance", "runway.md"), "runway");
  await writeFile(path.join(root, "company", "risk", "register.md"), "risk");

  const registry = await AgentRegistry.load(process.cwd());
  const documents = await loadAgentContext(root, registry.get("finance-ops"));
  assert.deepEqual(documents.map((document) => document.path), ["company/finance/runway.md", "company/goals.md"]);
});

test("does not follow a symlinked company context directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-context-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "agent-team-context-outside-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "goals.md"), "outside secret");
  await symlink(outside, path.join(root, "company"));

  const registry = await AgentRegistry.load(process.cwd());
  assert.deepEqual(await loadAgentContext(root, registry.get("founder-office")), []);
});
