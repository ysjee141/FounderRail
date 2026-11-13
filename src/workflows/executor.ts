import type { TaskStore } from "../store/task-store.js";
import { agentResultSchema, type AgentResult, type HandoffContract } from "../tasks/contracts.js";
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

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  taskStore: TaskStore,
  taskId: string,
  runner: AgentStepRunner,
): Promise<WorkflowExecutionResult> {
  const initialTask = taskStore.getTask(taskId);
  if (initialTask.status !== "ready") throw new Error(`Task ${taskId} must be ready, got ${initialTask.status}`);
  const task = taskStore.transitionTask(taskId, "running");
  const results = new Map<string, WorkflowStepResult>();
  const handoffs: HandoffContract[] = [];
  const pending = [...workflow.steps];

  while (pending.length > 0) {
    const readyIndex = pending.findIndex((candidate) => candidate.requires.every((id) => {
      const dependency = results.get(id);
      return dependency && ["completed", "skipped"].includes(dependency.status);
    }));
    if (readyIndex === -1) throw new Error(`Workflow ${workflow.id} made no progress despite a validated dependency graph`);
    const step = pending.splice(readyIndex, 1)[0];
    if (!step) throw new Error(`Workflow ${workflow.id} lost a pending step`);

    if (!shouldRun(step, task.risk_flags)) {
      results.set(step.id, { stepId: step.id, agentId: step.agent, status: "skipped", attempts: 0 });
      continue;
    }

    let attempts = 0;
    let lastError: unknown;
    while (attempts <= step.retry) {
      attempts += 1;
      try {
        const result = agentResultSchema.parse(await runner({
          workflow,
          step,
          task,
          priorHandoffs: [...handoffs],
        }));
        const handoff = taskStore.recordHandoff(taskId, step.agent, result);
        handoffs.push(handoff);
        if (result.status === "blocked" || result.status === "needs_input") {
          results.set(step.id, { stepId: step.id, agentId: step.agent, status: "blocked", attempts, handoff });
          taskStore.transitionTask(taskId, "blocked");
          return { workflowId: workflow.id, taskId, status: "blocked", steps: [...results.values()] };
        }
        results.set(step.id, { stepId: step.id, agentId: step.agent, status: "completed", attempts, handoff });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      results.set(step.id, {
        stepId: step.id,
        agentId: step.agent,
        status: "failed",
        attempts,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });
      taskStore.transitionTask(taskId, "failed");
      return { workflowId: workflow.id, taskId, status: "failed", steps: [...results.values()] };
    }
  }

  taskStore.transitionTask(taskId, "in_review");
  return { workflowId: workflow.id, taskId, status: "completed", steps: [...results.values()] };
}
