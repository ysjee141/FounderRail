import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AGENT_IDS } from "../agents/types.js";

export const TASK_STATUSES = [
  "draft",
  "ready",
  "running",
  "blocked",
  "in_review",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskContractSchema = z.object({
  id: z.string().regex(/^TASK-[A-Z0-9-]+$/),
  goal_id: z.string().nullable().optional(),
  owner_agent: z.enum(AGENT_IDS),
  objective: z.string().min(1),
  why: z.string().min(1),
  inputs: z.array(z.string()),
  scope: z.object({
    writable_paths: z.array(z.string()),
    forbidden_actions: z.array(z.string()),
  }),
  acceptance: z.array(z.string()),
  checks: z.array(z.string()),
  risk_flags: z.array(z.string()),
  approval: z.object({ required_for: z.array(z.string()) }),
  status: taskStatusSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type TaskContract = z.infer<typeof taskContractSchema>;

export const createTaskSchema = taskContractSchema.omit({
  id: true,
  status: true,
  created_at: true,
  updated_at: true,
});
export type CreateTask = z.infer<typeof createTaskSchema>;

export const agentResultSchema = z.object({
  status: z.enum(["completed", "needs_input", "blocked", "ready_for_review"]),
  summary: z.string().min(1),
  artifacts: z.array(z.string()),
  evidence: z.array(z.object({ claim: z.string(), source: z.string() })),
  decisions: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  requested_next_agent: z.enum(AGENT_IDS).nullable(),
});
export type AgentResult = z.infer<typeof agentResultSchema>;

export const handoffContractSchema = agentResultSchema.extend({
  id: z.string().regex(/^HANDOFF-[A-Z0-9-]+$/),
  task_id: z.string().regex(/^TASK-[A-Z0-9-]+$/),
  agent_id: z.enum(AGENT_IDS),
  created_at: z.iso.datetime(),
});
export type HandoffContract = z.infer<typeof handoffContractSchema>;

export function createTaskContract(input: CreateTask, now = new Date()): TaskContract {
  const timestamp = now.toISOString();
  return taskContractSchema.parse({
    ...createTaskSchema.parse(input),
    id: `TASK-${randomUUID().toUpperCase()}`,
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
  });
}

export function createHandoffContract(
  taskId: string,
  agentId: (typeof AGENT_IDS)[number],
  result: AgentResult,
  now = new Date(),
): HandoffContract {
  return handoffContractSchema.parse({
    ...agentResultSchema.parse(result),
    id: `HANDOFF-${randomUUID().toUpperCase()}`,
    task_id: taskId,
    agent_id: agentId,
    created_at: now.toISOString(),
  });
}
