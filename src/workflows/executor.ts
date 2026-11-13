import type { TaskStore } from "../store/task-store.js";
import { agentResultSchema, type AgentResult, type HandoffContract } from "../tasks/contracts.js";
import type { WorkflowRun } from "./runs.js";
import type {
  AgentStepRequest,
  WorkflowDefinition,
  WorkflowExecutionResult,
  WorkflowStep,
  WorkflowStepResult,
} from "./types.js";

export type AgentStepRunner = (request: AgentStepRequest) => Promise<AgentResult>;

function shouldRun(step: WorkflowStep, riskFlags: string[]): boolean {
  if (step.when === "always") return true;
  if (step.when === "risk_flags_present") return riskFlags.length > 0;
  return false;
}

function executionResult(taskStore: TaskStore, run: WorkflowRun): WorkflowExecutionResult {
  const steps: WorkflowStepResult[] = run.steps.map((step) => ({
    stepId: step.step_id,
    agentId: step.agent_id,
    status: step.status,
    attempts: step.attempts,
    ...(step.handoff_id ? { handoff: taskStore.getHandoff(step.handoff_id) } : {}),
    ...(step.error ? { error: step.error } : {}),
  }));
  return { runId: run.id, workflowId: run.workflow_id, taskId: run.task_id, status: run.status, steps };
}

function priorHandoffs(taskStore: TaskStore, run: WorkflowRun): HandoffContract[] {
  return run.steps.flatMap((step) => step.handoff_id ? [taskStore.getHandoff(step.handoff_id)] : []);
}

async function driveWorkflow(
  workflow: WorkflowDefinition,
  taskStore: TaskStore,
  initialRun: WorkflowRun,
  runner: AgentStepRunner,
): Promise<WorkflowExecutionResult> {
  const task = taskStore.getTask(initialRun.task_id);
  let run = initialRun;

  while (run.steps.some((step) => step.status === "pending")) {
    const ready = workflow.steps.find((candidate) => {
      const state = run.steps.find((step) => step.step_id === candidate.id);
      if (state?.status !== "pending") return false;
      return candidate.requires.every((id) => {
        const dependency = run.steps.find((step) => step.step_id === id);
        return dependency && ["completed", "skipped"].includes(dependency.status);
      });
    });
    if (!ready) throw new Error(`Workflow ${workflow.id} made no progress despite a validated dependency graph`);

    if (!shouldRun(ready, task.risk_flags)) {
      run = taskStore.skipWorkflowStep(run.id, ready.id);
      continue;
    }

    let attemptsThisExecution = 0;
    let lastError: unknown;
    while (attemptsThisExecution <= ready.retry) {
      attemptsThisExecution += 1;
      run = taskStore.startWorkflowStep(run.id, ready.id);
      try {
        const result = agentResultSchema.parse(await runner({
          workflow,
          step: ready,
          task,
          priorHandoffs: priorHandoffs(taskStore, run),
        }));
        const finished = taskStore.finishWorkflowStep(run.id, ready.id, ready.agent, result);
        run = finished.run;
        if (run.status === "blocked") return executionResult(taskStore, run);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attemptsThisExecution <= ready.retry) {
          run = taskStore.retryWorkflowStep(run.id, ready.id, error instanceof Error ? error.message : String(error));
        }
      }
    }

    if (lastError) {
      run = taskStore.failWorkflowStep(
        run.id,
        ready.id,
        lastError instanceof Error ? lastError.message : String(lastError),
      );
      return executionResult(taskStore, run);
    }
  }

  run = taskStore.completeWorkflowRun(run.id);
  return executionResult(taskStore, run);
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  taskStore: TaskStore,
  taskId: string,
  runner: AgentStepRunner,
): Promise<WorkflowExecutionResult> {
  const run = taskStore.startWorkflowRun(workflow, taskId);
  return driveWorkflow(workflow, taskStore, run, runner);
}

export async function resumeWorkflow(
  workflow: WorkflowDefinition,
  taskStore: TaskStore,
  runId: string,
  runner: AgentStepRunner,
): Promise<WorkflowExecutionResult> {
  const run = taskStore.resumeWorkflowRun(runId, workflow);
  return driveWorkflow(workflow, taskStore, run, runner);
}
