import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AGENT_IDS } from "../agents/types.js";
import type { WorkflowDefinition } from "./types.js";

export const WORKFLOW_RUN_STATUSES = ["running", "waiting_approval", "blocked", "failed", "completed"] as const;
export const workflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);

export const persistedWorkflowStepSchema = z.object({
  step_id: z.string().regex(/^[a-z0-9-]+$/),
  step_type: z.enum(["agent", "approval"]).default("agent"),
  agent_id: z.enum(AGENT_IDS).nullable(),
  status: z.enum(["pending", "running", "waiting_approval", "completed", "skipped", "blocked", "failed"]),
  attempts: z.number().int().min(0),
  handoff_id: z.string().regex(/^HANDOFF-[A-Z0-9-]+$/).nullable(),
  approval_id: z.string().regex(/^APPROVAL-[A-Z0-9-]+$/).nullable().default(null),
  error: z.string().nullable(),
}).strict();

export const workflowRunSchema = z.object({
  id: z.string().regex(/^RUN-[A-Z0-9-]+$/),
  workflow_id: z.string().regex(/^[a-z0-9-]+$/),
  workflow_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  task_id: z.string().regex(/^TASK-[A-Z0-9-]+$/),
  status: workflowRunStatusSchema,
  steps: z.array(persistedWorkflowStepSchema).min(1),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
}).strict();

export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type PersistedWorkflowStep = z.infer<typeof persistedWorkflowStepSchema>;

export function workflowDigest(workflow: WorkflowDefinition): string {
  return createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
}

export function createWorkflowRun(workflow: WorkflowDefinition, taskId: string, now = new Date()): WorkflowRun {
  const timestamp = now.toISOString();
  return workflowRunSchema.parse({
    id: `RUN-${randomUUID().toUpperCase()}`,
    workflow_id: workflow.id,
    workflow_sha256: workflowDigest(workflow),
    task_id: taskId,
    status: "running",
    steps: workflow.steps.map((step) => ({
      step_id: step.id,
      step_type: step.type,
      agent_id: step.type === "agent" ? step.agent : null,
      status: "pending",
      attempts: 0,
      handoff_id: null,
      approval_id: null,
      error: null,
    })),
    created_at: timestamp,
    updated_at: timestamp,
  });
}
