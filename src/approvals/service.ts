import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { resolveExistingProjectFile } from "../security/project-path.js";
import type { TaskStore } from "../store/task-store.js";
import type { ApprovalDecision, ApprovalRequest } from "./contracts.js";

export class ApprovalArtifactChangedError extends Error {}

async function artifactEvidence(root: string, candidate: string): Promise<{ relativePath: string; sha256: string }> {
  const rootReal = await realpath(root);
  const absolute = await resolveExistingProjectFile(root, candidate);
  const buffer = await readFile(absolute);
  return {
    relativePath: path.relative(rootReal, absolute).replaceAll(path.sep, "/"),
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function requestApproval(
  root: string,
  store: TaskStore,
  taskId: string,
  action: string,
  artifactPath: string,
): Promise<ApprovalRequest> {
  const artifact = await artifactEvidence(root, artifactPath);
  return store.requestApproval(taskId, action, artifact.relativePath, artifact.sha256);
}

export async function decideApproval(
  root: string,
  store: TaskStore,
  approvalId: string,
  decision: ApprovalDecision,
  reason: string,
): Promise<ApprovalRequest> {
  const current = store.getApproval(approvalId);
  const artifact = await artifactEvidence(root, current.artifact_path);
  if (decision === "approve" && artifact.sha256 !== current.artifact_sha256) {
    throw new ApprovalArtifactChangedError(`Approval artifact changed: ${current.artifact_path}`);
  }
  return store.decideApproval(approvalId, decision, reason);
}
