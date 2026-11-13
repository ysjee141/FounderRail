import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface EngineeringWorktree {
  taskId: string;
  branch: string;
  path: string;
  baseCommit: string;
}

export interface WorktreeEvidence {
  taskId: string;
  branch: string;
  path: string;
  baseCommit: string;
  headCommit: string;
  status: string[];
  changedFiles: string[];
  diffStat: string;
  diffCheckPassed: boolean;
  diffCheckOutput: string;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function safeTaskSlug(taskId: string): string {
  if (!/^TASK-[A-Z0-9-]+$/.test(taskId)) throw new Error(`Invalid task id for worktree: ${taskId}`);
  return taskId.toLowerCase();
}

export async function createEngineeringWorktree(
  root: string,
  taskId: string,
  baseRef = "HEAD",
): Promise<EngineeringWorktree> {
  const rootReal = await realpath(root);
  const repositoryRoot = await git(rootReal, ["rev-parse", "--show-toplevel"]);
  if (await realpath(repositoryRoot) !== rootReal) throw new Error("Run worktree creation from the repository root");

  const slug = safeTaskSlug(taskId);
  const branch = `agent-team/${slug}`;
  const worktreesDirectory = path.join(rootReal, ".agent-team", "worktrees");
  const worktreePath = path.join(worktreesDirectory, slug);
  const baseCommit = await git(rootReal, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
  await git(rootReal, ["check-ref-format", "--branch", branch]);
  await mkdir(worktreesDirectory, { recursive: true });
  await execFileAsync("git", ["-C", rootReal, "worktree", "add", "-b", branch, worktreePath, baseCommit], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return { taskId, branch, path: worktreePath, baseCommit };
}

export async function collectWorktreeEvidence(
  root: string,
  worktree: EngineeringWorktree,
): Promise<WorktreeEvidence> {
  const rootReal = await realpath(root);
  const worktreeReal = await realpath(worktree.path);
  const expectedParent = path.join(rootReal, ".agent-team", "worktrees") + path.sep;
  if (!worktreeReal.startsWith(expectedParent)) throw new Error("Engineering worktree is outside the managed directory");
  const actualBranch = await git(worktreeReal, ["branch", "--show-current"]);
  if (actualBranch !== worktree.branch) throw new Error(`Unexpected worktree branch: ${actualBranch}`);

  const statusText = await git(worktreeReal, ["status", "--porcelain=v1"]);
  const changedText = await git(worktreeReal, ["diff", "--name-only", worktree.baseCommit, "--"]);
  const diffStat = await git(worktreeReal, ["diff", "--stat", worktree.baseCommit, "--"]);
  let diffCheckPassed = true;
  let diffCheckOutput = "";
  try {
    diffCheckOutput = await git(worktreeReal, ["diff", "--check", worktree.baseCommit, "--"]);
  } catch (error) {
    diffCheckPassed = false;
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    diffCheckOutput = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim() || failure.message || "git diff --check failed";
  }

  return {
    taskId: worktree.taskId,
    branch: worktree.branch,
    path: worktreeReal,
    baseCommit: worktree.baseCommit,
    headCommit: await git(worktreeReal, ["rev-parse", "HEAD"]),
    status: statusText ? statusText.split("\n") : [],
    changedFiles: changedText ? changedText.split("\n") : [],
    diffStat,
    diffCheckPassed,
    diffCheckOutput,
  };
}
