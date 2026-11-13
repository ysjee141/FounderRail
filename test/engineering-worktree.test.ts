import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  collectWorktreeEvidence,
  createEngineeringWorktree,
  ensureEngineeringWorktree,
  loadEngineeringWorktree,
} from "../src/engineering/worktree.js";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function repository(t: import("node:test").TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await writeFile(path.join(root, ".gitignore"), ".agent-team/\n");
  await writeFile(path.join(root, "README.md"), "base\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "base"]);
  return root;
}

test("creates an isolated engineering branch without changing the main checkout", async (t) => {
  const root = await repository(t);
  const mainHead = await git(root, ["rev-parse", "HEAD"]);
  const worktree = await createEngineeringWorktree(root, "TASK-ABC-123");
  assert.equal(worktree.branch, "agent-team/task-abc-123");
  assert.equal(await git(worktree.path, ["branch", "--show-current"]), worktree.branch);
  assert.equal(await git(root, ["rev-parse", "HEAD"]), mainHead);
  assert.equal(await git(root, ["status", "--porcelain"]), "");
  assert.deepEqual(await loadEngineeringWorktree(root, "TASK-ABC-123"), worktree);
  assert.deepEqual(await ensureEngineeringWorktree(root, "TASK-ABC-123"), worktree);
});

test("includes untracked files in deterministic worktree evidence", async (t) => {
  const root = await repository(t);
  const worktree = await createEngineeringWorktree(root, "TASK-UNTRACKED");
  await writeFile(path.join(worktree.path, "untracked.txt"), "new\n");
  const evidence = await collectWorktreeEvidence(root, worktree);
  assert.deepEqual(evidence.changedFiles, ["untracked.txt"]);
});

test("collects changed files and diff-check evidence from the managed worktree", async (t) => {
  const root = await repository(t);
  const worktree = await createEngineeringWorktree(root, "TASK-EVIDENCE");
  await writeFile(path.join(worktree.path, "feature.txt"), "implemented\n");
  await git(worktree.path, ["add", "feature.txt"]);
  await git(worktree.path, ["commit", "-m", "implement feature"]);

  const evidence = await collectWorktreeEvidence(root, worktree);
  assert.equal(evidence.diffCheckPassed, true);
  assert.equal(evidence.baseCommit, worktree.baseCommit);
  assert.deepEqual(evidence.changedFiles, ["feature.txt"]);
  assert.notEqual(evidence.headCommit, worktree.baseCommit);
  assert.equal(await git(root, ["status", "--porcelain"]), "");
});

test("rejects invalid task ids before invoking git worktree", async (t) => {
  const root = await repository(t);
  await assert.rejects(() => createEngineeringWorktree(root, "../../escape"), /Invalid task id/);
});

test("refuses a redirected managed worktree directory", async (t) => {
  const root = await repository(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "agent-team-worktree-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, ".agent-team"));
  await assert.rejects(() => createEngineeringWorktree(root, "TASK-SYMLINK"), /redirected/);
});
