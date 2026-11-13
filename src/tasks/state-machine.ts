import type { TaskStatus } from "./contracts.js";

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["running", "cancelled"],
  running: ["blocked", "in_review", "waiting_approval", "failed", "cancelled"],
  blocked: ["ready", "running", "cancelled"],
  in_review: ["running", "waiting_approval", "completed", "failed"],
  waiting_approval: ["running", "completed", "cancelled"],
  completed: [],
  failed: ["ready", "cancelled"],
  cancelled: [],
};

export class InvalidTaskTransitionError extends Error {}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTaskTransitionError(`Invalid task transition: ${from} -> ${to}`);
  }
}

export function allowedTaskTransitions(status: TaskStatus): readonly TaskStatus[] {
  return ALLOWED_TRANSITIONS[status];
}
