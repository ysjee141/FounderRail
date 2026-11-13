import { z } from "zod";
import { AGENT_IDS } from "../agents/types.js";
import type { HandoffContract, TaskContract } from "../tasks/contracts.js";

export const workflowStepSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  agent: z.enum(AGENT_IDS),
  prompt: z.string().min(1),
  requires: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  when: z.enum(["always", "risk_flags_present"]).default("always"),
  retry: z.number().int().min(0).max(3).default(1),
});

export const workflowDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStepStatus = "pending" | "running" | "completed" | "skipped" | "blocked" | "failed";

export interface WorkflowStepResult {
  stepId: string;
  agentId: WorkflowStep["agent"];
  status: WorkflowStepStatus;
  attempts: number;
  handoff?: HandoffContract;
  error?: string;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  taskId: string;
  status: "completed" | "blocked" | "failed";
  steps: WorkflowStepResult[];
}

export interface AgentStepRequest {
  workflow: WorkflowDefinition;
  step: WorkflowStep;
  task: TaskContract;
  priorHandoffs: HandoffContract[];
}
