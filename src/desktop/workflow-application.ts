import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { decideApproval, requestWorkflowApproval } from "../approvals/service.js";
import { resolveExistingProjectFile } from "../security/project-path.js";
import { TaskStore } from "../store/task-store.js";
import { createTaskSchema, type CreateTask } from "../tasks/contracts.js";
import type { ApprovalDecision } from "../approvals/contracts.js";
import { collectWorktreeEvidence, loadEngineeringWorktree } from "../engineering/worktree.js";
import { executeWorkflow, resumeWorkflow } from "../workflows/executor.js";
import { loadWorkflow } from "../workflows/loader.js";
import { createRuntimeWorkflowRunner } from "../workflows/runtime-runner.js";
import type { ApprovalStepRequest } from "../workflows/types.js";
import { inspectDesktopProject } from "./application.js";

const execFileAsync = promisify(execFile);
const riskFlagSchema = z.enum(["security", "personal-data", "payments", "authentication", "database", "network"]);

function openStore(projectRoot: string): Promise<TaskStore> {
  return TaskStore.open(path.join(projectRoot, ".agent-team", "state.db"));
}

function approvalRunner(projectRoot: string, store: TaskStore) {
  return async ({ step, runId }: ApprovalStepRequest): Promise<void> => {
    await requestWorkflowApproval(projectRoot, store, runId, step.id, step.action, step.artifact);
  };
}

function retainStoreUntilComplete(store: TaskStore, operation: Promise<unknown>): void {
  void operation
    .catch((error) => console.error("Desktop workflow failed:", error))
    .finally(() => {
      try {
        store.close();
      } catch (error) {
        console.error("Could not close workflow database:", error);
      }
    });
}

export interface DesktopIdeaInput {
  objective: string;
  problem: string;
  targetCustomer: string;
}

export interface DesktopFeatureInput {
  objective: string;
  problem: string;
  writablePaths: string[];
  acceptance: string[];
  riskFlags: string[];
}

const desktopIdeaInputSchema = z.object({
  objective: z.string().trim().min(1).max(180),
  problem: z.string().trim().min(1).max(3000),
  targetCustomer: z.string().trim().min(1).max(300),
}).strict();

const desktopFeatureInputSchema = z.object({
  objective: z.string().trim().min(1).max(180),
  problem: z.string().trim().min(1).max(3000),
  writablePaths: z.array(z.string().trim().min(1).max(240)).min(1).max(25),
  acceptance: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
  riskFlags: z.array(riskFlagSchema).max(6),
}).strict();

async function requireCleanGitProject(projectRoot: string, harnessRoot: string) {
  const snapshot = await inspectDesktopProject(projectRoot, harnessRoot);
  if (!snapshot.initialized) throw new Error("먼저 Harness Runtime을 설정하세요.");
  if (!snapshot.git.isRepository) throw new Error("제품 구현 전에 프로젝트를 Git 저장소로 초기화하세요.");
  if (!snapshot.git.clean) throw new Error("현재 프로젝트에 저장되지 않은 변경이 있습니다. 먼저 commit하거나 변경을 정리하세요.");
  return snapshot;
}

function buildFeatureTask(input: z.infer<typeof desktopFeatureInputSchema>): CreateTask {
  return createTaskSchema.parse({
    owner_agent: "founder-office",
    objective: input.objective,
    why: input.problem,
    inputs: [],
    scope: {
      writable_paths: input.writablePaths,
      forbidden_actions: ["merge", "commit", "deploy", "배포", "외부 고객에게 연락", "결제 시작", "쓰기 범위 밖의 파일 수정"],
    },
    acceptance: input.acceptance,
    checks: ["수용 조건을 확인한다.", "관련 검사를 실행하고 결과를 Handoff에 기록한다.", "변경 파일이 쓰기 범위 안에 있는지 확인한다."],
    risk_flags: input.riskFlags,
    approval: { required_for: ["merge", "release", "deploy", "external_write"] },
  });
}

async function launchWorkflow(
  projectRoot: string,
  harnessRoot: string,
  input: CreateTask,
  workflowId: string,
) {
  const workflow = await loadWorkflow(harnessRoot, workflowId);
  const store = await openStore(projectRoot);
  let retained = false;
  try {
    const task = store.createTask(input);
    store.transitionTask(task.id, "ready");
    const runner = await createRuntimeWorkflowRunner(projectRoot, 300_000, undefined, harnessRoot);
    const operation = executeWorkflow(workflow, store, task.id, runner, approvalRunner(projectRoot, store));
    retainStoreUntilComplete(store, operation);
    retained = true;
    return await inspectDesktopProject(projectRoot, harnessRoot);
  } catch (error) {
    if (!retained) store.close();
    throw error;
  }
}

export async function startDesktopIdeaValidation(
  projectRoot: string,
  harnessRoot: string,
  rawInput: DesktopIdeaInput,
) {
  const { objective, problem, targetCustomer } = desktopIdeaInputSchema.parse(rawInput);

  const input: CreateTask = createTaskSchema.parse({
    owner_agent: "founder-office",
    objective,
    why: problem,
    inputs: [`대상 고객: ${targetCustomer}`],
    scope: {
      writable_paths: [],
      forbidden_actions: ["외부 고객에게 연락", "결제 또는 구독 시작", "가격 변경", "코드 수정", "배포"],
    },
    acceptance: [
      "고객 문제와 현재 대안을 요약한다.",
      "가장 위험한 가정과 이를 검증할 실험을 제안한다.",
      "비용 및 가격 가설을 검토하고 창업자의 결정 항목을 제시한다.",
    ],
    checks: ["주장과 근거를 구분한다.", "미확인 정보와 추정을 표시한다."],
    risk_flags: [],
    approval: { required_for: ["외부 실행", "결제", "가격 변경"] },
  });

  return launchWorkflow(projectRoot, harnessRoot, input, "idea-validation");
}

export async function startDesktopFeatureDelivery(
  projectRoot: string,
  harnessRoot: string,
  rawInput: DesktopFeatureInput,
) {
  await requireCleanGitProject(projectRoot, harnessRoot);
  const parsed = desktopFeatureInputSchema.parse(rawInput);
  const input = buildFeatureTask(parsed);
  return launchWorkflow(projectRoot, harnessRoot, input, "feature-delivery");
}

export async function getDesktopTaskReview(projectRoot: string, taskId: string) {
  const store = await openStore(projectRoot);
  try {
    store.getTask(taskId);
  } finally {
    store.close();
  }
  const worktree = await loadEngineeringWorktree(projectRoot, taskId);
  const evidence = await collectWorktreeEvidence(projectRoot, worktree);
  let diffParts: string[] = [];
  let diffTruncated = false;
  try {
    const result = await execFileAsync("git", [
      "-C", worktree.path, "diff", "--no-ext-diff", "--no-color", "--no-renames", evidence.baseCommit, "--",
    ], { encoding: "utf8", maxBuffer: 2_000_000 });
    diffParts.push(result.stdout);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string };
    if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      diffParts.push("Diff exceeds the desktop preview limit. Use git diff in the Task worktree to inspect it.");
      diffTruncated = true;
    } else {
      throw error;
    }
  }
  const untrackedResult = await execFileAsync("git", ["-C", worktree.path, "ls-files", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  for (const file of untrackedResult.stdout.split("\0").filter(Boolean)) {
    const absolute = path.resolve(worktree.path, file);
    const relative = path.relative(worktree.path, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    if (await realpath(absolute) !== absolute) continue;
    const details = await lstat(absolute);
    if (details.isSymbolicLink() || !details.isFile()) continue;
    try {
      const added = await execFileAsync("git", [
        "-C", worktree.path, "diff", "--no-index", "--no-color", "--", "/dev/null", absolute,
      ], { encoding: "utf8", maxBuffer: 2_000_000 });
      diffParts.push(added.stdout);
    } catch (error) {
      const failure = error as { code?: string | number; stdout?: string; message?: string };
      if (failure.code === 1) diffParts.push(failure.stdout ?? "");
      else if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        diffParts.push(`\nDiff too large to preview: ${file}\n`);
        diffTruncated = true;
      } else throw error;
    }
    if (diffParts.reduce((size, part) => size + part.length, 0) > 180_000) {
      diffTruncated = true;
      break;
    }
  }
  let diff = diffParts.join("\n");
  if (diff.length > 180_000) {
    diff = diff.slice(0, 180_000);
    diffTruncated = true;
  }
  return {
    taskId,
    branch: evidence.branch,
    baseCommit: evidence.baseCommit,
    headCommit: evidence.headCommit,
    changedFiles: evidence.changedFiles,
    diffStat: evidence.diffStat,
    diffCheckPassed: evidence.diffCheckPassed,
    diffCheckOutput: evidence.diffCheckOutput,
    diff,
    diffTruncated,
  };
}

export async function getDesktopApprovalArtifact(projectRoot: string, approvalId: string) {
  const store = await openStore(projectRoot);
  let approval;
  try {
    approval = store.getApproval(approvalId);
  } finally {
    store.close();
  }
  const file = await resolveExistingProjectFile(projectRoot, approval.artifact_path);
  const details = await stat(file);
  if (!details.isFile() || details.size > 200_000) throw new Error("승인 문서가 일반 텍스트 파일이 아니거나 너무 큽니다.");
  const contentBytes = await readFile(file);
  if (contentBytes.includes(0)) throw new Error("승인 문서가 텍스트 파일이 아닙니다.");
  const currentSha256 = createHash("sha256").update(contentBytes).digest("hex");
  const content = contentBytes.toString("utf8");
  return {
    approval,
    content,
    currentSha256,
    artifactChanged: currentSha256 !== approval.artifact_sha256,
  };
}

export async function decideDesktopApproval(
  projectRoot: string,
  harnessRoot: string,
  approvalId: string,
  decision: ApprovalDecision,
  reason: string,
) {
  const parsedDecision = z.enum(["approve", "reject"]).parse(decision);
  const parsedReason = z.string().trim().min(1).max(1000).parse(reason);
  const store = await openStore(projectRoot);
  try {
    await decideApproval(projectRoot, store, approvalId, parsedDecision, parsedReason);
  } finally {
    store.close();
  }
  return inspectDesktopProject(projectRoot, harnessRoot);
}

export async function resumeDesktopWorkflow(
  projectRoot: string,
  harnessRoot: string,
  runId: string,
): Promise<void> {
  const store = await openStore(projectRoot);
  let retained = false;
  try {
    const run = store.getWorkflowRun(runId);
    const workflow = await loadWorkflow(harnessRoot, run.workflow_id);
    const runner = await createRuntimeWorkflowRunner(projectRoot, 300_000, undefined, harnessRoot);
    const operation = resumeWorkflow(workflow, store, runId, runner, approvalRunner(projectRoot, store));
    retainStoreUntilComplete(store, operation);
    retained = true;
  } catch (error) {
    if (!retained) store.close();
    throw error;
  }
}
