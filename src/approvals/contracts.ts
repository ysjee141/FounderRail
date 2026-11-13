import { randomUUID } from "node:crypto";
import { z } from "zod";

export const APPROVAL_DECISIONS = ["approve", "reject", "request_changes"] as const;
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const approvalRequestSchema = z.object({
  id: z.string().regex(/^APPROVAL-[A-Z0-9-]+$/),
  task_id: z.string().regex(/^TASK-[A-Z0-9-]+$/),
  action: z.string().min(1),
  artifact_path: z.string().min(1),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "approved", "rejected", "changes_requested"]),
  created_at: z.iso.datetime(),
  resolved_at: z.iso.datetime().nullable(),
  decision_reason: z.string().nullable(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export function createApprovalRequest(
  taskId: string,
  action: string,
  artifactPath: string,
  artifactSha256: string,
  now = new Date(),
): ApprovalRequest {
  return approvalRequestSchema.parse({
    id: `APPROVAL-${randomUUID().toUpperCase()}`,
    task_id: taskId,
    action,
    artifact_path: artifactPath,
    artifact_sha256: artifactSha256,
    status: "pending",
    created_at: now.toISOString(),
    resolved_at: null,
    decision_reason: null,
  });
}
