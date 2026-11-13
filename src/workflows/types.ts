import { z } from "zod";
import { AGENT_IDS, type AgentId } from "../agents/types.js";
import type { ApprovalRequest } from "../approvals/contracts.js";
import type { HandoffContract, TaskContract } from "../tasks/contracts.js";

const commonStepFields = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  requires: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  when: z.enum(["always", "risk_flags_present"]).default("always"),
};

export const agentWorkflowStepSchema = z.object({
  ...commonStepFields,
  type: z.literal("agent"),
  agent: z.enum(AGENT_IDS),
  prompt: z.string().min(1),
  retry: z.number().int().min(0).max(3).default(1),
}).strict();

export const approvalWorkflowStepSchema = z.object({
  ...commonStepFields,
  type: z.literal("approval"),
  action: z.string().min(1),
  artifact: z.string().min(1),
}).strict();

export const workflowStepSchema = z.preprocess(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value) && !("type" in value)
    ? { ...value, type: "agent" }
    : value,
  z.discriminatedUnion("type", [agentWorkflowStepSchema, approvalWorkflowStepSchema]),
);

export const workflowDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type AgentWorkflowStep = z.infer<typeof agentWorkflowStepSchema>;
export type ApprovalWorkflowStep = z.infer<typeof approvalWorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStepStatus = "pending" | "running" | "waiting_approval" | "completed" | "skipped" | "blocked" | "failed";

export interface WorkflowStepResult {
  stepId: string;
  agentId: AgentId | null;
  status: WorkflowStepStatus;
  attempts: number;
  handoff?: HandoffContract;
  approval?: ApprovalRequest;
  error?: string;
}

export interface WorkflowExecutionResult {
  runId: string;
  workflowId: string;
  taskId: string;
  status: "running" | "waiting_approval" | "completed" | "blocked" | "failed";
  steps: WorkflowStepResult[];
}

export interface AgentStepRequest {
  workflow: WorkflowDefinition;
  step: AgentWorkflowStep;
  task: TaskContract;
  priorHandoffs: HandoffContract[];
}

export interface ApprovalStepRequest {
  workflow: WorkflowDefinition;
  step: ApprovalWorkflowStep;
  task: TaskContract;
  runId: string;
}
