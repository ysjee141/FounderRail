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
import type { WorkflowDefinition } from "../workflows/types.js";
import {
  createWorkflowRun,
  workflowDigest,
  workflowRunSchema,
  type PersistedWorkflowStep,
  type WorkflowRun,
} from "../workflows/runs.js";

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
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        status TEXT NOT NULL,
        document TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_task_created ON workflow_runs(task_id, created_at, id);
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

  getHandoff(id: string): HandoffContract {
    const row = this.db.prepare("SELECT document FROM handoffs WHERE id = ?").get(id) as { document: string } | undefined;
    if (!row) throw new Error(`Handoff not found: ${id}`);
    return handoffContractSchema.parse(JSON.parse(row.document));
  }

  startWorkflowRun(workflow: WorkflowDefinition, taskId: string): WorkflowRun {
    const task = this.getTask(taskId);
    if (task.status !== "ready") throw new Error(`Task ${taskId} must be ready, got ${task.status}`);
    const run = createWorkflowRun(workflow, taskId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.transitionTask(taskId, "running");
      this.db.prepare(`
        INSERT INTO workflow_runs (id, workflow_id, task_id, status, document, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(run.id, run.workflow_id, run.task_id, run.status, JSON.stringify(run), run.created_at, run.updated_at);
      this.db.exec("COMMIT");
      return run;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getWorkflowRun(id: string): WorkflowRun {
    const row = this.db.prepare("SELECT document FROM workflow_runs WHERE id = ?").get(id) as { document: string } | undefined;
    if (!row) throw new Error(`Workflow run not found: ${id}`);
    return workflowRunSchema.parse(JSON.parse(row.document));
  }

  listWorkflowRuns(taskId?: string): WorkflowRun[] {
    if (taskId) this.getTask(taskId);
    const rows = (taskId
      ? this.db.prepare("SELECT document FROM workflow_runs WHERE task_id = ? ORDER BY created_at DESC, id DESC").all(taskId)
      : this.db.prepare("SELECT document FROM workflow_runs ORDER BY created_at DESC, id DESC").all()
    ) as Array<{ document: string }>;
    return rows.map((row) => workflowRunSchema.parse(JSON.parse(row.document)));
  }

  resumeWorkflowRun(id: string, workflow: WorkflowDefinition): WorkflowRun {
    const current = this.getWorkflowRun(id);
    if (current.workflow_id !== workflow.id) {
      throw new Error(`Workflow run ${id} belongs to ${current.workflow_id}, not ${workflow.id}`);
    }
    if (current.workflow_sha256 !== workflowDigest(workflow)) {
      throw new Error(`Workflow ${workflow.id} changed after run ${id} started`);
    }
    if (current.status === "completed") throw new Error(`Workflow run already completed: ${id}`);
    const competing = this.db.prepare(`
      SELECT id FROM workflow_runs
      WHERE task_id = ? AND id <> ? AND status IN ('running', 'blocked')
      ORDER BY created_at DESC LIMIT 1
    `).get(current.task_id, id) as { id: string } | undefined;
    if (competing) throw new Error(`Task ${current.task_id} has another active workflow run: ${competing.id}`);
    const task = this.getTask(current.task_id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (task.status === "blocked") this.transitionTask(task.id, "running");
      else if (task.status === "failed") {
        this.transitionTask(task.id, "ready");
        this.transitionTask(task.id, "running");
      } else if (task.status !== "running") {
        throw new Error(`Task ${task.id} cannot resume from ${task.status}`);
      }
      const resumed = workflowRunSchema.parse({
        ...current,
        status: "running",
        steps: current.steps.map((step) => ["running", "blocked", "failed"].includes(step.status)
          ? { ...step, status: "pending", error: null }
          : step),
        updated_at: new Date().toISOString(),
      });
      this.saveWorkflowRun(current, resumed);
      this.db.exec("COMMIT");
      return resumed;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  startWorkflowStep(runId: string, stepId: string): WorkflowRun {
    return this.updateWorkflowRun(runId, (current) => ({
      ...current,
      steps: current.steps.map((step) => step.step_id === stepId
        ? { ...step, status: "running" as const, attempts: step.attempts + 1, error: null }
        : step),
    }), stepId, ["pending"]);
  }

  retryWorkflowStep(runId: string, stepId: string, error: string): WorkflowRun {
    return this.updateWorkflowRun(runId, (current) => ({
      ...current,
      steps: current.steps.map((step) => step.step_id === stepId
        ? { ...step, status: "pending" as const, error }
        : step),
    }), stepId, ["running"]);
  }

  skipWorkflowStep(runId: string, stepId: string): WorkflowRun {
    return this.updateWorkflowRun(runId, (current) => ({
      ...current,
      steps: current.steps.map((step) => step.step_id === stepId
        ? { ...step, status: "skipped" as const, error: null }
        : step),
    }), stepId, ["pending"]);
  }

  finishWorkflowStep(
    runId: string,
    stepId: string,
    agentId: AgentId,
    result: AgentResult,
  ): { run: WorkflowRun; handoff: HandoffContract } {
    const current = this.getWorkflowRun(runId);
    const step = this.assertWorkflowStep(current, stepId, ["running"]);
    if (step.agent_id !== agentId) throw new Error(`Workflow step ${stepId} belongs to ${step.agent_id}, not ${agentId}`);
    const handoff = createHandoffContract(current.task_id, agentId, result);
    const blocked = result.status === "blocked" || result.status === "needs_input";
    const updated = workflowRunSchema.parse({
      ...current,
      status: blocked ? "blocked" : current.status,
      steps: current.steps.map((item) => item.step_id === stepId
        ? { ...item, status: blocked ? "blocked" : "completed", handoff_id: handoff.id, error: null }
        : item),
      updated_at: new Date().toISOString(),
    });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO handoffs (id, task_id, agent_id, document, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(handoff.id, handoff.task_id, handoff.agent_id, JSON.stringify(handoff), handoff.created_at);
      if (blocked) this.transitionTask(current.task_id, "blocked");
      this.saveWorkflowRun(current, updated);
      this.db.exec("COMMIT");
      return { run: updated, handoff };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  failWorkflowStep(runId: string, stepId: string, error: string): WorkflowRun {
    const current = this.getWorkflowRun(runId);
    this.assertWorkflowStep(current, stepId, ["running"]);
    const updated = workflowRunSchema.parse({
      ...current,
      status: "failed",
      steps: current.steps.map((step) => step.step_id === stepId
        ? { ...step, status: "failed", error }
        : step),
      updated_at: new Date().toISOString(),
    });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.transitionTask(current.task_id, "failed");
      this.saveWorkflowRun(current, updated);
      this.db.exec("COMMIT");
      return updated;
    } catch (caught) {
      this.db.exec("ROLLBACK");
      throw caught;
    }
  }

  completeWorkflowRun(runId: string): WorkflowRun {
    const current = this.getWorkflowRun(runId);
    if (current.steps.some((step) => !["completed", "skipped"].includes(step.status))) {
      throw new Error(`Workflow run has unfinished steps: ${runId}`);
    }
    const updated = workflowRunSchema.parse({ ...current, status: "completed", updated_at: new Date().toISOString() });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.transitionTask(current.task_id, "in_review");
      this.saveWorkflowRun(current, updated);
      this.db.exec("COMMIT");
      return updated;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private assertWorkflowStep(run: WorkflowRun, stepId: string, allowed: PersistedWorkflowStep["status"][]): PersistedWorkflowStep {
    const step = run.steps.find((item) => item.step_id === stepId);
    if (!step) throw new Error(`Workflow step not found in ${run.id}: ${stepId}`);
    if (!allowed.includes(step.status)) throw new Error(`Workflow step ${stepId} must be ${allowed.join(" or ")}, got ${step.status}`);
    return step;
  }

  private updateWorkflowRun(
    runId: string,
    update: (current: WorkflowRun) => Omit<WorkflowRun, "updated_at"> | WorkflowRun,
    stepId: string,
    allowed: PersistedWorkflowStep["status"][],
  ): WorkflowRun {
    const current = this.getWorkflowRun(runId);
    if (current.status !== "running") throw new Error(`Workflow run ${runId} is ${current.status}`);
    this.assertWorkflowStep(current, stepId, allowed);
    const updated = workflowRunSchema.parse({ ...update(current), updated_at: new Date().toISOString() });
    this.saveWorkflowRun(current, updated);
    return updated;
  }

  private saveWorkflowRun(current: WorkflowRun, updated: WorkflowRun): void {
    const result = this.db.prepare(`
      UPDATE workflow_runs SET status = ?, document = ?, updated_at = ? WHERE id = ? AND document = ?
    `).run(updated.status, JSON.stringify(updated), updated.updated_at, current.id, JSON.stringify(current));
    if (result.changes !== 1) throw new Error(`Concurrent workflow run update detected: ${current.id}`);
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
