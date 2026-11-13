import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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

function statePath(root: string, taskId: string): string {
  return path.join(root, ".agent-team", "engineering-worktrees", `${safeTaskSlug(taskId)}.json`);
}

async function managedDirectory(root: string, relative: string): Promise<string> {
  let target = root;
  for (const segment of relative.split("/")) {
    target = path.join(target, segment);
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error(`Managed directory was redirected: ${relative}`);
      if (!info.isDirectory()) throw new Error(`Managed path is not a directory: ${relative}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(target);
    }
  }
  if (await realpath(target) !== target) throw new Error(`Managed directory was redirected: ${relative}`);
  return target;
}

async function validateWorktree(root: string, value: unknown): Promise<EngineeringWorktree> {
  if (typeof value !== "object" || value === null) throw new Error("Invalid engineering worktree state");
  const candidate = value as Partial<EngineeringWorktree>;
  if (!candidate.taskId || !candidate.branch || !candidate.path || !candidate.baseCommit) {
    throw new Error("Incomplete engineering worktree state");
  }
  const slug = safeTaskSlug(candidate.taskId);
  const expectedPath = path.join(root, ".agent-team", "worktrees", slug);
  if (candidate.path !== expectedPath || candidate.branch !== `agent-team/${slug}`) {
    throw new Error("Engineering worktree state does not match its task");
  }
  const worktreeReal = await realpath(candidate.path);
  if (worktreeReal !== expectedPath) throw new Error("Engineering worktree path was redirected");
  if (await git(worktreeReal, ["branch", "--show-current"]) !== candidate.branch) {
    throw new Error("Engineering worktree branch does not match saved state");
  }
  if (await git(worktreeReal, ["rev-parse", "--verify", `${candidate.baseCommit}^{commit}`]) !== candidate.baseCommit) {
    throw new Error("Engineering worktree base commit is invalid");
  }
  return candidate as EngineeringWorktree;
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
  const worktreesDirectory = await managedDirectory(rootReal, ".agent-team/worktrees");
  const worktreePath = path.join(worktreesDirectory, slug);
  const baseCommit = await git(rootReal, ["rev-parse", "--verify", `${baseRef}^{commit}`]);
  await git(rootReal, ["check-ref-format", "--branch", branch]);
  await execFileAsync("git", ["-C", rootReal, "worktree", "add", "-b", branch, worktreePath, baseCommit], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const worktree = { taskId, branch, path: worktreePath, baseCommit };
  await managedDirectory(rootReal, ".agent-team/engineering-worktrees");
  const stateFile = statePath(rootReal, taskId);
  await writeFile(stateFile, `${JSON.stringify(worktree, null, 2)}\n`, { flag: "wx" });
  return worktree;
}

export async function loadEngineeringWorktree(root: string, taskId: string): Promise<EngineeringWorktree> {
  const rootReal = await realpath(root);
  await managedDirectory(rootReal, ".agent-team/engineering-worktrees");
  const value = JSON.parse(await readFile(statePath(rootReal, taskId), "utf8")) as unknown;
  const worktree = await validateWorktree(rootReal, value);
  if (worktree.taskId !== taskId) throw new Error(`Engineering worktree belongs to ${worktree.taskId}, not ${taskId}`);
  return worktree;
}

export async function ensureEngineeringWorktree(
  root: string,
  taskId: string,
  baseRef = "HEAD",
): Promise<EngineeringWorktree> {
  try {
    return await loadEngineeringWorktree(root, taskId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return createEngineeringWorktree(root, taskId, baseRef);
  }
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

  const status = statusText ? statusText.split("\n") : [];
  const changedFiles = new Set(changedText ? changedText.split("\n") : []);
  for (const entry of status) {
    const statusPath = entry.slice(3);
    const finalPath = statusPath.includes(" -> ") ? statusPath.split(" -> ").at(-1) : statusPath;
    if (finalPath) changedFiles.add(finalPath.replace(/^"|"$/g, ""));
  }

  return {
    taskId: worktree.taskId,
    branch: worktree.branch,
    path: worktreeReal,
    baseCommit: worktree.baseCommit,
    headCommit: await git(worktreeReal, ["rev-parse", "HEAD"]),
    status,
    changedFiles: [...changedFiles].sort(),
    diffStat,
    diffCheckPassed,
    diffCheckOutput,
  };
}
