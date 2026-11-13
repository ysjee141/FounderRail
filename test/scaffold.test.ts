import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scaffoldProject } from "../src/context/scaffold.js";

test("creates company, knowledge and work templates without overwriting existing files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-scaffold-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "existing-placeholder"), "keep");

  const first = await scaffoldProject(root);
  assert.ok(first.created.includes("company/profile.yaml"));
  assert.ok(first.created.includes("knowledge/catalog.yaml"));
  assert.ok(first.created.includes("work/tasks/README.md"));

  await writeFile(path.join(root, "company", "charter.md"), "user-owned\n");
  const second = await scaffoldProject(root);
  assert.ok(second.skipped.includes("company/charter.md"));
  assert.equal(await readFile(path.join(root, "company", "charter.md"), "utf8"), "user-owned\n");
});

test("refuses to scaffold through a symlinked target directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-scaffold-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "agent-team-scaffold-outside-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, "company"));
  await symlink(outside, path.join(root, "company", "finance"));
  await assert.rejects(() => scaffoldProject(root), /symlink/);
});
