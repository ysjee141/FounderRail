import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { initializeConfig, isRuntimeName } from "../src/config.js";
import { scaffoldProject } from "../src/context/scaffold.js";
import { getRuntimeAdapter } from "../src/runtime/registry.js";
import { TaskStore } from "../src/store/task-store.js";
import { executeWorkflow } from "../src/workflows/executor.js";
import { loadWorkflow } from "../src/workflows/loader.js";
import { createRuntimeWorkflowRunner } from "../src/workflows/runtime-runner.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const runtime = process.argv[2] ?? "codex";
  if (!isRuntimeName(runtime)) throw new Error("Runtime must be claude, codex or gemini");
  const adapter = getRuntimeAdapter(runtime);
  const probe = await adapter.probe();
  if (!probe.available) throw new Error(`${runtime} is not available: ${probe.error}`);

  const harnessRoot = process.cwd();
  const project = await mkdtemp(path.join(os.tmpdir(), "agent-team-live-workflow-"));
  let store: TaskStore | undefined;
  const started = Date.now();
  try {
    for (const directory of ["agents", "schemas", "workflows", "examples"]) {
      await cp(path.join(harnessRoot, directory), path.join(project, directory), { recursive: true });
    }
    await scaffoldProject(project);
    await initializeConfig(project, runtime);
    const idea = await readFile(path.join(project, "examples", "solo-saas", "idea.md"), "utf8");
    await writeFile(path.join(project, "company", "product.md"), `# Product\n\n${idea}`);
    await writeFile(path.join(project, "company", "customers.md"), "# Customers\n\n초기 가설: 반복 업무를 줄이려는 소규모 B2B 팀. 아직 검증되지 않았다.\n");
    await writeFile(path.join(project, "company", "goals.md"), "# Goals\n\n구현 전에 문제·가격·비용 가설과 가장 작은 검증 실험을 정한다.\n");
    await writeFile(path.join(project, "work", "research", "fixture-interviews.md"), `# Synthetic interview evidence for harness smoke only

이 문서는 실제 시장 근거가 아니라 Harness 전체 경로를 검증하기 위한 합성 fixture다.

- 운영 담당자 A: 주간 점검 결과가 문서와 채팅에 흩어져 후속 조치를 놓쳤다고 진술했다.
- 팀 리드 B: 누가 어떤 evidence를 확인했는지 추적하기 어렵다고 진술했다.
- 창업자 C: 복잡한 자동화보다 반복 checklist와 검토 기록을 먼저 원한다고 진술했다.

아직 검증되지 않은 가설: 팀당 월 49,000원을 지불할 수 있다.
`);
    await writeFile(path.join(project, "company", "finance", "monthly-summary.md"), `# Synthetic finance assumptions for harness smoke only

- 기준일: 2026-11-13
- 통화: KRW
- 사용 가능 현금: 10,000,000
- 검증 기간 월 비용 상한: 500,000
- 이번 실험 지출 상한: 200,000
- 확정 매출: 0
- 가격 가설: 팀당 월 49,000 (검증되지 않음)
- 위 수치는 실제 사업 데이터가 아닌 smoke fixture다.
`);
    await cp(
      path.join(project, "examples", "solo-saas", "profile.yaml"),
      path.join(project, "company", "profile.yaml"),
      { force: true },
    );
    await execFileAsync("git", ["-C", project, "init", "-b", "main"], { encoding: "utf8" });

    store = await TaskStore.open(path.join(project, ".agent-team", "state.db"));
    const task = store.createTask({
      owner_agent: "product-growth",
      objective: "샘플 B2B SaaS 아이디어의 문제·가격·비용 가설과 1주 검증 실험을 준비한다.",
      why: "실제 구현 전에 가장 위험한 가정을 evidence로 줄이기 위해서다.",
      inputs: ["examples/solo-saas/idea.md", "company/profile.yaml"],
      scope: { writable_paths: [], forbidden_actions: ["external.publish", "financial.commitment"] },
      acceptance: ["미확인 정보는 가정으로 표시한다", "창업자가 선택할 다음 실험이 명확하다"],
      checks: [],
      risk_flags: [],
      approval: { required_for: [] },
    });
    store.transitionTask(task.id, "ready");
    const workflow = await loadWorkflow(project, "idea-validation");
    const runner = await createRuntimeWorkflowRunner(project, 120_000);
    const result = await executeWorkflow(workflow, store, task.id, runner);
    if (result.status !== "completed") {
      throw new Error(`Live workflow ended with ${result.status}: ${JSON.stringify(result.steps.map((step) => ({
        id: step.stepId,
        status: step.status,
        error: step.error,
      })))}`);
    }
    const handoffs = store.listHandoffs(task.id);
    if (handoffs.length !== workflow.steps.length) throw new Error(`Expected ${workflow.steps.length} handoffs, got ${handoffs.length}`);
    if (store.getTask(task.id).status !== "in_review") throw new Error("Live workflow task did not reach in_review");
    console.log(JSON.stringify({
      runtime,
      runtime_version: probe.version,
      workflow: workflow.id,
      run_id: result.runId,
      task_id: task.id,
      steps: result.steps.map((step) => ({ id: step.stepId, status: step.status, attempts: step.attempts })),
      handoffs: handoffs.length,
      duration_ms: Date.now() - started,
      project_is_temporary: true,
    }, null, 2));
  } finally {
    store?.close();
    await rm(project, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
