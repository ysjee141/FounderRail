import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createTaskContract } from "../src/tasks/contracts.js";
import { validateWorkflow } from "../src/workflows/loader.js";
import { createRuntimeWorkflowRunner, type RuntimeAgentExecution } from "../src/workflows/runtime-runner.js";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
}

const validResult = {
  status: "completed" as const,
  summary: "session completed",
  artifacts: [],
  evidence: [],
  decisions: [],
  assumptions: [],
  risks: [],
  requested_next_agent: null,
};

test("runs engineering plan, implementation and review in isolated modes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-runtime-workflow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(process.cwd(), "agents"), path.join(root, "agents"), { recursive: true });
  await cp(path.join(process.cwd(), "schemas"), path.join(root, "schemas"), { recursive: true });
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "company"));
  await mkdir(path.join(root, "work"));
  await writeFile(path.join(root, ".gitignore"), ".agent-team/\n");
  await writeFile(path.join(root, "src", "base.ts"), "export const base = true;\n");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "base"]);

  const task = createTaskContract({
    owner_agent: "engineering",
    objective: "Implement a bounded change",
    why: "Verify isolated engineering sessions",
    inputs: [],
    scope: { writable_paths: ["src/**"], forbidden_actions: ["production.deploy"] },
    acceptance: ["Review sees the implementation diff"],
    checks: [],
    risk_flags: [],
    approval: { required_for: ["merge"] },
  });
  const workflow = validateWorkflow({
    id: "engineering-sessions",
    name: "Engineering sessions",
    description: "Plan, implement and review",
    steps: [
      { id: "plan", agent: "engineering", execution: "engineering-plan", prompt: "plan", requires: [], when: "always", retry: 0 },
      { id: "implement", agent: "engineering", execution: "engineering-implement", prompt: "implement", requires: ["plan"], when: "always", retry: 0 },
      { id: "review", agent: "engineering", execution: "engineering-review", prompt: "review", requires: ["implement"], when: "always", retry: 0 },
    ],
  });
  const executions: RuntimeAgentExecution[] = [];
  const runner = await createRuntimeWorkflowRunner(root, 10_000, async (execution) => {
    executions.push(execution);
    if (execution.mode === "workspace-write") {
      await writeFile(path.join(execution.cwd, "src", "change.ts"), "export const changed = true;\n");
    }
    return validResult;
  });

  const plan = workflow.steps[0];
  const implement = workflow.steps[1];
  const review = workflow.steps[2];
  assert.ok(plan?.type === "agent" && implement?.type === "agent" && review?.type === "agent");
  await runner({ workflow, step: plan, task, priorHandoffs: [] });
  const implemented = await runner({ workflow, step: implement, task, priorHandoffs: [] });
  const reviewed = await runner({ workflow, step: review, task, priorHandoffs: [] });

  assert.equal(executions[0]?.mode, "read-only");
  assert.equal(executions[0]?.cwd, root);
  assert.equal(executions[1]?.mode, "workspace-write");
  assert.match(executions[1]?.cwd ?? "", /\.agent-team\/worktrees\/task-/);
  assert.equal(executions[2]?.mode, "read-only");
  assert.equal(executions[2]?.cwd, executions[1]?.cwd);
  assert.ok(implemented.artifacts.some((item) => item === "changed-file:src/change.ts"));
  assert.ok(reviewed.evidence.some((item) => item.claim === "git diff --check passed"));

  const worktreePath = executions[1]?.cwd;
  assert.ok(worktreePath);
  await writeFile(path.join(worktreePath, "README.md"), "outside task scope\n");
  await assert.rejects(
    () => runner({ workflow, step: review, task, priorHandoffs: [] }),
    /escaped Task writable scope: README.md/,
  );
});
