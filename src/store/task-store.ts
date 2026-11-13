import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentId } from "../agents/types.js";
import {
  approvalRequestSchema,
  createApprovalRequest,
  type ApprovalDecision,
  type ApprovalRequest,
} from "../approvals/contracts.js";
import {
  createHandoffContract,
  createTaskContract,
  handoffContractSchema,
  taskContractSchema,
  type AgentResult,
  type CreateTask,
  type HandoffContract,
  type TaskContract,
  type TaskStatus,
} from "../tasks/contracts.js";
import { assertTaskTransition } from "../tasks/state-machine.js";

export class TaskNotFoundError extends Error {}

export class TaskStore {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(databasePath: string): Promise<TaskStore> {
    await mkdir(path.dirname(databasePath), { recursive: true });
    const db = new DatabaseSync(databasePath);
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        owner_agent TEXT NOT NULL,
        document TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        agent_id TEXT NOT NULL,
        document TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_handoffs_task_created ON handoffs(task_id, created_at, id);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        status TEXT NOT NULL,
        document TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_approvals_status_created ON approvals(status, created_at, id);
    `);
    return new TaskStore(db);
  }

  close(): void {
    this.db.close();
  }

  createTask(input: CreateTask): TaskContract {
    const task = createTaskContract(input);
    this.db.prepare(`
      INSERT INTO tasks (id, status, owner_agent, document, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(task.id, task.status, task.owner_agent, JSON.stringify(task), task.created_at, task.updated_at);
    return task;
  }

  getTask(id: string): TaskContract {
    const row = this.db.prepare("SELECT document FROM tasks WHERE id = ?").get(id) as { document: string } | undefined;
    if (!row) throw new TaskNotFoundError(`Task not found: ${id}`);
    return taskContractSchema.parse(JSON.parse(row.document));
  }

  transitionTask(id: string, to: TaskStatus): TaskContract {
    const current = this.getTask(id);
    assertTaskTransition(current.status, to);
    const updated = taskContractSchema.parse({ ...current, status: to, updated_at: new Date().toISOString() });
    const result = this.db.prepare(`
      UPDATE tasks SET status = ?, document = ?, updated_at = ? WHERE id = ? AND status = ?
    `).run(updated.status, JSON.stringify(updated), updated.updated_at, id, current.status);
    if (result.changes !== 1) throw new Error(`Concurrent task update detected: ${id}`);
    return updated;
  }

  recordHandoff(taskId: string, agentId: AgentId, result: AgentResult): HandoffContract {
    this.getTask(taskId);
    const handoff = createHandoffContract(taskId, agentId, result);
    this.db.prepare(`
      INSERT INTO handoffs (id, task_id, agent_id, document, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(handoff.id, handoff.task_id, handoff.agent_id, JSON.stringify(handoff), handoff.created_at);
    return handoff;
  }

  listHandoffs(taskId: string): HandoffContract[] {
    this.getTask(taskId);
    const rows = this.db.prepare(`
      SELECT document FROM handoffs WHERE task_id = ? ORDER BY created_at, id
    `).all(taskId) as Array<{ document: string }>;
    return rows.map((row) => handoffContractSchema.parse(JSON.parse(row.document)));
  }

  requestApproval(taskId: string, action: string, artifactPath: string, artifactSha256: string): ApprovalRequest {
    const approval = createApprovalRequest(taskId, action, artifactPath, artifactSha256);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.transitionTask(taskId, "waiting_approval");
      this.db.prepare(`
        INSERT INTO approvals (id, task_id, status, document, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(approval.id, approval.task_id, approval.status, JSON.stringify(approval), approval.created_at);
      this.db.exec("COMMIT");
      return approval;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getApproval(id: string): ApprovalRequest {
    const row = this.db.prepare("SELECT document FROM approvals WHERE id = ?").get(id) as { document: string } | undefined;
    if (!row) throw new Error(`Approval not found: ${id}`);
    return approvalRequestSchema.parse(JSON.parse(row.document));
  }

  listPendingApprovals(): ApprovalRequest[] {
    const rows = this.db.prepare(`
      SELECT document FROM approvals WHERE status = 'pending' ORDER BY created_at, id
    `).all() as Array<{ document: string }>;
    return rows.map((row) => approvalRequestSchema.parse(JSON.parse(row.document)));
  }

  decideApproval(id: string, decision: ApprovalDecision, reason: string): ApprovalRequest {
    if (!reason.trim()) throw new Error("Approval decision reason is required");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getApproval(id);
      if (current.status !== "pending") throw new Error(`Approval already decided: ${id}`);
      const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
      const taskStatus = decision === "approve" ? "completed" : decision === "reject" ? "cancelled" : "running";
      const updated = approvalRequestSchema.parse({
        ...current,
        status,
        resolved_at: new Date().toISOString(),
        decision_reason: reason.trim(),
      });
      const result = this.db.prepare(`
        UPDATE approvals SET status = ?, document = ?, resolved_at = ? WHERE id = ? AND status = 'pending'
      `).run(updated.status, JSON.stringify(updated), updated.resolved_at, id);
      if (result.changes !== 1) throw new Error(`Concurrent approval decision detected: ${id}`);
      this.transitionTask(current.task_id, taskStatus);
      this.db.exec("COMMIT");
      return updated;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
