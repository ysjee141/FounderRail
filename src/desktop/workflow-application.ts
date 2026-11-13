import path from "node:path";
import { z } from "zod";
import { requestWorkflowApproval } from "../approvals/service.js";
import { TaskStore } from "../store/task-store.js";
import { createTaskSchema, type CreateTask } from "../tasks/contracts.js";
import { executeWorkflow, resumeWorkflow } from "../workflows/executor.js";
import { loadWorkflow } from "../workflows/loader.js";
import { createRuntimeWorkflowRunner } from "../workflows/runtime-runner.js";
import type { ApprovalStepRequest } from "../workflows/types.js";
import { inspectDesktopProject } from "./application.js";

function openStore(projectRoot: string): Promise<TaskStore> {
  return TaskStore.open(path.join(projectRoot, ".agent-team", "state.db"));
}

function approvalRunner(projectRoot: string, store: TaskStore) {
  return async ({ step, runId }: ApprovalStepRequest): Promise<void> => {
    await requestWorkflowApproval(projectRoot, store, runId, step.id, step.action, step.artifact);
  };
}

function retainStoreUntilComplete(store: TaskStore, operation: Promise<unknown>): void {
  void operation.catch(() => undefined).finally(() => store.close());
}

export interface DesktopIdeaInput {
  objective: string;
  problem: string;
  targetCustomer: string;
}

const desktopIdeaInputSchema = z.object({
  objective: z.string().trim().min(1).max(180),
  problem: z.string().trim().min(1).max(3000),
  targetCustomer: z.string().trim().min(1).max(300),
}).strict();

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

  const workflow = await loadWorkflow(harnessRoot, "idea-validation");
  const store = await openStore(projectRoot);
  try {
    const task = store.createTask(input);
    store.transitionTask(task.id, "ready");
    const runner = await createRuntimeWorkflowRunner(projectRoot, 300_000, undefined, harnessRoot);
    const operation = executeWorkflow(workflow, store, task.id, runner, approvalRunner(projectRoot, store));
    retainStoreUntilComplete(store, operation);
    return await inspectDesktopProject(projectRoot, harnessRoot);
  } catch (error) {
    store.close();
    throw error;
  }
}

export async function resumeDesktopWorkflow(
  projectRoot: string,
  harnessRoot: string,
  runId: string,
): Promise<void> {
  const store = await openStore(projectRoot);
  try {
    const run = store.getWorkflowRun(runId);
    const workflow = await loadWorkflow(harnessRoot, run.workflow_id);
    const runner = await createRuntimeWorkflowRunner(projectRoot, 300_000, undefined, harnessRoot);
    const operation = resumeWorkflow(workflow, store, runId, runner, approvalRunner(projectRoot, store));
    retainStoreUntilComplete(store, operation);
  } catch (error) {
    store.close();
    throw error;
  }
}
