import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentRegistry } from "../src/agents/registry.js";
import { DocumentOwnershipError, writeScopedArtifact } from "../src/context/scoped-writer.js";

test("writes only inside the owning agent's document scope and returns hashes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-writer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agent = (await AgentRegistry.load(process.cwd())).get("finance-ops");

  const evidence = await writeScopedArtifact(root, agent, "company/finance/runway.md", "runway\n");
  assert.equal(evidence.previousSha256, null);
  assert.equal(await readFile(path.join(root, "company", "finance", "runway.md"), "utf8"), "runway\n");
  await assert.rejects(
    () => writeScopedArtifact(root, agent, "company/risk/register.md", "forbidden"),
    DocumentOwnershipError,
  );
});

test("rejects a symlinked parent even when the logical path is in scope", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-writer-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "agent-team-outside-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, "company"));
  await symlink(outside, path.join(root, "company", "finance"));
  const agent = (await AgentRegistry.load(process.cwd())).get("finance-ops");

  await assert.rejects(
    () => writeScopedArtifact(root, agent, "company/finance/runway.md", "escape"),
    DocumentOwnershipError,
  );
});
