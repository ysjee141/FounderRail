const app = document.querySelector("#app");
const state = { project: null, recent: [], busy: false, pollTimer: null, taskReview: null, taskReviewLoading: null, taskReviewError: null, approvalArtifact: null, approvalLoading: null, activeNav: "overview", knowledge: null, knowledgeLoading: false };

const runtimeNames = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

const statusNames = {
  draft: "초안",
  ready: "준비됨",
  running: "실행 중",
  blocked: "추가 정보 필요",
  in_review: "검토 중",
  waiting_approval: "승인 대기",
  needs_input: "입력 요청",
  ready_for_review: "검토 준비",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
  rejected: "거절됨",
  approved: "승인됨",
  changes_requested: "수정 요청",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function toast(message, isError = false) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = `toast${isError ? " error" : ""}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 3800);
}

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

function badge(status) {
  const label = statusNames[status] ?? status;
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function renderWelcome() {
  const recentMarkup = state.recent.length
    ? `<div class="recent-list">${state.recent.map((root, index) => `
        <button class="recent-button" data-recent-index="${index}">
          <span class="recent-icon">⌂</span>
          <span><span class="recent-name">${escapeHtml(root.split(/[\\/]/).filter(Boolean).at(-1))}</span><span class="recent-path">${escapeHtml(root)}</span></span>
        </button>`).join("")}</div>`
    : `<div class="empty-copy">최근에 연 프로젝트가 없습니다.</div>`;

  app.innerHTML = `
    <main class="welcome-wrap">
      <div class="welcome-brand"><span class="brand-mark">F</span><span><span class="brand-name">Founder Desk</span><span class="brand-caption">Agent-Team Workspace</span></span></div>
      <div class="eyebrow">One-person company, supported</div>
      <h1 class="welcome-title">사업과 개발을<br />한곳에서 시작하세요.</h1>
      <p class="welcome-copy">프로젝트 폴더를 열면 제품 문서, Agent workflow, 작업 결과를 한 화면에서 관리할 수 있습니다. 명령어를 외울 필요가 없습니다.</p>
      <button id="open-project" class="button">프로젝트 폴더 열기 <span>→</span></button>
      <section class="card welcome-card">
        <div class="panel-title">최근 프로젝트</div>
        ${recentMarkup}
      </section>
    </main>`;

  document.querySelector("#open-project").addEventListener("click", openProject);
  document.querySelectorAll("[data-recent-index]").forEach((button) => {
    button.addEventListener("click", () => openRecent(Number(button.dataset.recentIndex)));
  });
}

function runtimeSetup(snapshot) {
  const defaultRuntime = snapshot.runtime
    ?? snapshot.runtimes.find((runtime) => runtime.name === "codex" && runtime.available)?.name
    ?? snapshot.runtimes.find((runtime) => runtime.available)?.name;
  const options = snapshot.runtimes.map((runtime) => {
    const available = runtime.available;
    const selected = defaultRuntime === runtime.name;
    const status = available ? (runtime.version || "설치됨") : "설치 확인 필요";
    return `
      <label class="runtime-option${available ? "" : " disabled"}">
        <input type="radio" name="runtime" value="${escapeHtml(runtime.name)}" ${selected ? "checked" : ""} ${available ? "" : "disabled"} />
        <span><span class="runtime-option-name">${escapeHtml(runtimeNames[runtime.name] ?? runtime.name)}</span><span class="runtime-option-status">${escapeHtml(status)}</span></span>
      </label>`;
  }).join("");
  const gitNotice = snapshot.git.isRepository
    ? `<div class="notice info"><span>✓</span><span>Git 저장소입니다. 현재 브랜치: <strong>${escapeHtml(snapshot.git.branch || "detached")}</strong>${snapshot.git.clean ? " · 작업 폴더가 깨끗합니다." : " · 저장되지 않은 변경이 있습니다."}</span></div>`
    : `<div class="notice warn"><span>!</span><span>이 폴더는 Git 저장소가 아닙니다. Harness는 초기화할 수 있습니다. 코드 구현 workflow를 실행하기 전에 Git 저장소와 기준 commit을 준비하세요.</span></div>`;

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar(snapshot, "overview")}
      <main class="main-area">
        <div class="topbar"><div class="crumb">프로젝트 설정 <span> / </span><strong>${escapeHtml(snapshot.name)}</strong></div><div class="top-actions"><button class="icon-button" id="refresh" aria-label="새로고침">↻</button><div class="avatar">나</div></div></div>
        <div class="page-head"><div><div class="eyebrow">Project setup</div><h1>Harness를 연결합니다.</h1><p class="subtitle">프로젝트에서 사용할 Coding Agent CLI를 하나 선택하세요. 선택한 CLI가 Agent workflow를 실행합니다.</p></div></div>
        <div class="project-path">${escapeHtml(snapshot.root)}</div>
        ${gitNotice}
        <section class="card setup-card">
          <div class="panel-title">사용할 Coding Agent</div>
          <p class="panel-description">CLI가 설치되어 있어야 합니다. 최초 인증은 해당 CLI에서 완료하세요.</p>
          <div class="runtime-options">${options}</div>
          <div class="setup-footer"><span class="setup-help">나중에 설정에서 Runtime을 바꿀 수 있습니다.</span><button class="button" id="initialize" ${snapshot.runtimes.every((item) => !item.available) ? "disabled" : ""}>${snapshot.runtime ? "설정 저장" : "Harness 초기화"} <span>→</span></button></div>
        </section>
      </main>
    </div>`;

  document.querySelector("#initialize").addEventListener("click", snapshot.initialized ? saveRuntime : initializeProject);
  document.querySelector("#refresh").addEventListener("click", refreshProject);
}

function sidebar(snapshot, selected) {
  const runtime = snapshot.runtime ? runtimeNames[snapshot.runtime] : "Runtime 미설정";
  return `
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">F</span><span><span class="brand-name">Founder Desk</span><span class="brand-caption">Agent-Team Workspace</span></span></div>
      <div class="nav-label">Workspace</div>
      <nav class="nav-list">
        <button class="nav-item ${selected === "overview" ? "active" : ""}" data-nav="overview"><span class="icon">◫</span>개요</button>
        <button class="nav-item ${selected === "ideas" ? "active" : ""}" data-nav="ideas"><span class="icon">✳</span>사업 검증</button>
        <button class="nav-item ${selected === "build" ? "active" : ""}" data-nav="build" ${snapshot.git.isRepository && snapshot.git.clean ? "" : "disabled"} title="Git 저장소가 깨끗해야 제품 개발을 시작할 수 있습니다."><span class="icon">⌘</span>제품 개발</button>
      </nav>
      <div class="nav-label spaced">Company</div>
      <nav class="nav-list">
        <button class="nav-item ${selected === "knowledge" ? "active" : ""}" data-nav="knowledge"><span class="icon">▤</span>지식 자료</button>
        <button class="nav-item ${selected === "finance" ? "active" : ""}" data-nav="finance"><span class="icon">◉</span>재무</button>
        <button class="nav-item ${selected === "risk" ? "active" : ""}" data-nav="risk"><span class="icon">◇</span>보안과 위험</button>
      </nav>
      <div class="sidebar-bottom"><div class="runtime-chip"><span class="runtime-dot"></span>${escapeHtml(runtime)}</div><div class="runtime-caption">현재 프로젝트 Runtime</div></div>
    </aside>`;
}

function taskRows(tasks) {
  if (!tasks.length) return `<div class="empty-state"><div class="empty-mark">＋</div><div class="empty-title">아직 작업이 없습니다.</div><div class="empty-copy">사업, 제품, 재무 또는 위험 검토를 시작해보세요.</div></div>`;
  return `<div class="task-list">${tasks.slice(0, 5).map((task) => `
    <div class="task-row"><div class="row-primary"><div class="row-title">${escapeHtml(task.objective)}</div><div class="row-meta">${escapeHtml(task.id)} · ${escapeHtml(task.owner_agent)} · ${dateLabel(task.updated_at)}</div></div>${badge(task.status)}</div>`).join("")}</div>`;
}

function runRows(runs, handoffs, agents) {
  if (!runs.length) return `<div class="empty-state"><div class="empty-mark">↗</div><div class="empty-title">실행 기록이 없습니다.</div><div class="empty-copy">workflow 실행 결과가 이곳에 표시됩니다.</div></div>`;
  return `<div class="run-list">${runs.slice(0, 5).map((run) => {
    const completed = run.steps.filter((step) => ["completed", "skipped"].includes(step.status)).length;
    const blockedStep = run.steps.find((step) => step.status === "blocked");
    const blockedHandoff = blockedStep?.handoff_id
      ? handoffs.find((handoff) => handoff.id === blockedStep.handoff_id)
      : null;
    const blockedAgent = agents.find((agent) => agent.id === blockedStep?.agent_id);
    const runningStep = run.steps.find((step) => step.status === "running");
    return `
    <div class="run-row"><div class="row-primary"><div class="row-title">${escapeHtml(run.workflow_id)}</div><div class="row-meta">${escapeHtml(run.id)} · ${escapeHtml(run.task_id)} · ${dateLabel(run.updated_at)}</div><div class="row-meta">단계 ${completed}/${run.steps.length} 완료${runningStep ? ` · 진행 중: ${escapeHtml(runningStep.step_id)}` : blockedStep ? ` · 중단: ${escapeHtml(blockedStep.step_id)}` : ""}</div>${run.steps.find((step) => step.error)?.error ? `<div class="run-error">${escapeHtml(run.steps.find((step) => step.error).error)}</div>` : ""}${run.status === "blocked" ? `<div class="run-blocked-help"><strong>${escapeHtml(blockedAgent?.name ?? blockedStep?.agent_id ?? blockedStep?.step_id ?? "Agent")} 단계에서 추가 정보가 필요합니다.</strong><p>${escapeHtml(blockedHandoff?.summary ?? "Agent가 추가 정보를 요청했습니다. 아래 입력란에 필요한 내용을 적고 재개하세요.")}</p>${blockedHandoff?.decisions?.length ? `<div class="run-next-label">Agent의 확인 요청</div><ul>${blockedHandoff.decisions.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}${blockedHandoff?.risks?.length ? `<div class="run-next-label">남은 위험</div><ul>${blockedHandoff.risks.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}<label class="run-resume-field">보완 정보<textarea data-resume-input rows="2" maxlength="3000" placeholder="Agent가 요청한 정보나 결정을 적어주세요."></textarea></label><button class="button small-button" data-resume-workflow="${escapeHtml(run.id)}">정보를 보완하고 재개</button><div class="field-help">완료된 단계는 건너뛰고 중단된 단계부터 이어서 실행합니다.</div></div>` : ""}${run.workflow_id === "feature-delivery" && run.steps.some((step) => step.step_id === "engineering-implement" && step.status === "completed") ? `<button class="text-link review-link" data-review-task="${escapeHtml(run.task_id)}">변경 검토</button>` : ""}</div>${badge(run.status)}</div>`;
  }).join("")}</div>`;
}

async function resumeWorkflowFromDashboard(runId) {
  const button = [...document.querySelectorAll("[data-resume-workflow]")]
    .find((item) => item.dataset.resumeWorkflow === runId);
  const additionalInput = button?.closest(".run-row")?.querySelector("[data-resume-input]")?.value ?? "";
  if (!additionalInput.trim()) {
    toast("Agent가 요청한 보완 정보를 입력하세요.", true);
    return;
  }
  const resumed = await withBusy("보완 정보를 저장하고 Workflow를 재개합니다", () => (
    window.founderDesk.resumeWorkflow(runId, additionalInput)
  ));
  if (resumed) toast("보완 정보를 전달했습니다. Workflow가 중단된 단계부터 다시 실행됩니다.");
}

function approvalRows(approvals) {
  if (!approvals.length) return `<div class="empty-copy">현재 승인 요청이 없습니다.</div>`;
  return `<div class="approval-list">${approvals.map((approval) => `
    <div class="approval-row"><div class="row-primary"><div class="row-title">${escapeHtml(approval.action)} · ${escapeHtml(approval.task_id)}</div><div class="row-meta">검토 문서: ${escapeHtml(approval.artifact_path)} · ${dateLabel(approval.created_at)}</div></div><button class="button secondary small-button" data-approval-artifact="${escapeHtml(approval.id)}">문서와 diff 검토</button></div>`).join("")}</div>`;
}

function renderDashboard(snapshot) {
  const activeRuns = snapshot.runs.filter((run) => ["running", "blocked", "waiting_approval"].includes(run.status)).length;
  const resultsReady = snapshot.tasks.filter((task) => ["in_review", "completed"].includes(task.status)).length;
  const approvals = snapshot.approvals.length;
  const selectedRuntime = snapshot.runtimes.find((runtime) => runtime.name === snapshot.runtime);
  const gitMessage = snapshot.git.isRepository
    ? `현재 브랜치 ${escapeHtml(snapshot.git.branch || "detached")}`
    : "Git 저장소를 연결하면 코드 변경을 검토할 수 있습니다.";

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar(snapshot, state.activeNav || "overview")}
      <main class="main-area">
        <div class="topbar"><div class="crumb">Workspace <span> / </span><strong>${escapeHtml(snapshot.name)}</strong></div><div class="top-actions"><button class="button secondary" id="open-another">프로젝트 전환</button><button class="icon-button" id="refresh" aria-label="새로고침">↻</button><div class="avatar">나</div></div></div>
        <div class="page-head"><div><div class="eyebrow">Your company workspace</div><h1>좋은 아침입니다.</h1><p class="subtitle">사업 가설, 제품 작업, Agent 팀의 진행 상황을 이곳에서 확인하세요.</p></div><div class="head-actions"><button class="button secondary" id="setup-button">프로젝트 설정</button><button class="button secondary" id="new-feature" ${snapshot.git.isRepository && snapshot.git.clean ? "" : "disabled"}>제품 개발 시작</button><button class="button" id="new-idea">아이디어 검증 시작 <span>→</span></button></div></div>
        ${selectedRuntime?.available ? "" : `<div class="notice warn"><span>!</span><span>선택한 Runtime을 찾을 수 없습니다. 프로젝트 설정에서 설치된 CLI를 선택하세요.</span></div>`}
        ${!snapshot.git.isRepository ? `<div class="notice warn"><span>!</span><span>제품 개발 workflow는 Git 저장소가 필요합니다. 프로젝트 폴더에서 Git을 초기화하고 기준 commit을 만드세요.</span></div>` : !snapshot.git.clean ? `<div class="notice warn"><span>!</span><span>제품 개발을 시작하기 전에 현재 변경사항을 commit하거나 정리하세요. Agent는 별도 Task worktree에서 작업합니다.</span></div>` : ""}
        <div class="grid">
          ${approvals ? `<section class="card approval-panel"><div class="panel-header"><div><div class="panel-title">사람의 검토가 필요합니다</div><div class="panel-description">승인 전에 Task 변경 diff와 승인 문서를 함께 확인하세요.</div></div><span class="badge waiting_approval">${approvals}건 대기</span></div>${approvalRows(snapshot.approvals)}</section>` : ""}
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">전체 Task</span><span class="stat-icon">▤</span></div><div class="stat-value">${snapshot.tasks.length}</div><div class="stat-foot">${resultsReady}건 결과 준비</div></section>
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">진행 중인 Workflow</span><span class="stat-icon">↗</span></div><div class="stat-value">${activeRuns}</div><div class="stat-foot">실행, 확인 또는 승인 대기</div></section>
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">승인 대기</span><span class="stat-icon">✓</span></div><div class="stat-value">${approvals}</div><div class="stat-foot">${snapshot.runtime ? escapeHtml(runtimeNames[snapshot.runtime]) : "Runtime 미설정"}</div></section>
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">Git 상태</span><span class="stat-icon">⌘</span></div><div class="stat-value compact">${snapshot.git.isRepository ? (snapshot.git.clean ? "Clean" : "변경 있음") : "미연결"}</div><div class="stat-foot">${gitMessage}</div></section>
          <section class="card panel"><div class="panel-header"><div><div class="panel-title">최근 작업</div><div class="panel-description">Task 상태와 담당 Agent</div></div><button class="text-link" id="refresh-tasks">새로고침</button></div>${taskRows(snapshot.tasks)}</section>
          <section class="card panel side-panel"><div class="panel-header"><div><div class="panel-title">Workflow 기록</div><div class="panel-description">진행 단계, 필요한 입력과 다음 행동</div></div><button class="text-link" id="refresh-runs">새로고침</button></div>${runRows(snapshot.runs, snapshot.handoffs, snapshot.agents)}</section>
          <section class="card panel"><div class="panel-header"><div><div class="panel-title">최근 Agent 결과</div><div class="panel-description">Agent가 다음 작업자에게 전달한 요약</div></div></div>${handoffRows(snapshot.handoffs)}</section>
          ${renderTaskReview()}
          ${renderApprovalArtifact()}
          ${state.activeNav === "knowledge" ? renderKnowledgePanel() : ""}
          <section class="card panel side-panel"><div class="panel-header"><div><div class="panel-title">사용 가능한 Agent</div><div class="panel-description">선택한 Runtime으로 역할을 실행합니다</div></div><span class="badge ready">${escapeHtml(runtimeNames[snapshot.runtime] ?? "설정 필요")}</span></div><div class="grid agent-grid">${snapshot.agents.slice(0, 6).map((agent) => `<div class="card agent-card"><div class="agent-name">${escapeHtml(agent.name)}</div><div class="agent-description">${escapeHtml(agent.description)}</div></div>`).join("")}</div></section>
          <section class="card panel"><div class="panel-header"><div><div class="panel-title">시작할 Workflow</div><div class="panel-description">이 프로젝트에서 사용할 수 있는 작업 흐름</div></div></div><div class="task-list">${snapshot.workflows.map((workflow) => `<div class="task-row"><div class="workflow-copy"><div class="row-title">${escapeHtml(workflow.name)}</div><div class="row-meta">${escapeHtml(workflow.description)}</div></div><div class="workflow-action"><span class="badge">${workflow.stepCount}단계</span>${["weekly-operations", "monthly-close", "incident"].includes(workflow.id) ? `<button class="text-link" data-operational-workflow="${escapeHtml(workflow.id)}">시작</button>` : ""}</div></div>`).join("")}</div></section>
        </div>
      </main>
    </div>`;

  document.querySelector("#open-another").addEventListener("click", openProject);
  document.querySelector("#refresh").addEventListener("click", refreshProject);
  document.querySelector("#refresh-tasks").addEventListener("click", refreshProject);
  document.querySelector("#refresh-runs").addEventListener("click", refreshProject);
  document.querySelector("#refresh-approvals")?.addEventListener("click", refreshProject);
  document.querySelector("#setup-button").addEventListener("click", () => runtimeSetup(state.project));
  document.querySelector("#new-idea").addEventListener("click", openIdeaDialog);
  document.querySelector("#new-feature").addEventListener("click", openFeatureDialog);
  document.querySelectorAll('[data-nav="ideas"]').forEach((button) => button.addEventListener("click", openIdeaDialog));
  document.querySelectorAll('[data-nav="build"]').forEach((button) => button.addEventListener("click", openFeatureDialog));
  document.querySelectorAll('[data-nav="finance"]').forEach((button) => button.addEventListener("click", () => openOperationalDialog("monthly-close")));
  document.querySelectorAll('[data-nav="risk"]').forEach((button) => button.addEventListener("click", () => openOperationalDialog("incident")));
  document.querySelectorAll('[data-nav="knowledge"]').forEach((button) => button.addEventListener("click", openKnowledgePanel));
  document.querySelectorAll("[data-operational-workflow]").forEach((button) => button.addEventListener("click", () => openOperationalDialog(button.dataset.operationalWorkflow)));
  document.querySelectorAll("[data-resume-workflow]").forEach((button) => button.addEventListener("click", () => resumeWorkflowFromDashboard(button.dataset.resumeWorkflow)));
  document.querySelector("#refresh-knowledge")?.addEventListener("click", openKnowledgePanel);
  document.querySelectorAll("[data-review-task]").forEach((button) => button.addEventListener("click", () => openTaskReview(button.dataset.reviewTask)));
  document.querySelectorAll("[data-approval-artifact]").forEach((button) => button.addEventListener("click", () => openApprovalArtifact(button.dataset.approvalArtifact)));
  document.querySelector("#approve-release")?.addEventListener("click", () => decideApproval("approve"));
  document.querySelector("#reject-release")?.addEventListener("click", () => decideApproval("reject"));
  document.querySelector("#close-review")?.addEventListener("click", () => { state.taskReview = null; state.taskReviewError = null; render(); });
  document.querySelector("#close-review-error")?.addEventListener("click", () => { state.taskReviewError = null; render(); });
  document.querySelector("#close-approval-review")?.addEventListener("click", () => { state.approvalArtifact = null; render(); });
  document.querySelectorAll("[data-review-approval-task]").forEach((button) => button.addEventListener("click", () => openTaskReview(button.dataset.reviewApprovalTask)));
  syncWorkflowPolling(snapshot);
}

function handoffRows(handoffs) {
  if (!handoffs?.length) return `<div class="empty-state compact-empty"><div class="empty-mark">↗</div><div class="empty-title">아직 전달된 결과가 없습니다.</div><div class="empty-copy">Workflow를 실행하면 Agent별 분석이 여기에 표시됩니다.</div></div>`;
  return `<div class="handoff-list">${handoffs.slice(-6).reverse().map((handoff) => `
    <article class="handoff-row"><div class="handoff-head"><div><div class="row-title">${escapeHtml(handoff.agent_id)} · ${escapeHtml(handoff.task_id)}</div><div class="row-meta">${dateLabel(handoff.created_at)}</div></div>${badge(handoff.status)}</div><p class="handoff-summary">${escapeHtml(handoff.summary)}</p>${handoff.decisions?.length ? `<div class="handoff-points"><strong>결정 항목</strong><ul>${handoff.decisions.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}${handoff.risks?.length ? `<div class="handoff-risk">남은 위험: ${escapeHtml(handoff.risks.slice(0, 2).join(" · "))}</div>` : ""}</article>`).join("")}</div>`;
}

function renderTaskReview() {
  if (state.taskReviewLoading) return `<section class="card review-panel"><div class="loading"><span class="spinner"></span><span>${escapeHtml(state.taskReviewLoading)}의 변경사항을 불러옵니다</span></div></section>`;
  if (state.taskReviewError) return `<section class="card review-panel"><div class="panel-header"><div class="panel-title">변경사항을 열지 못했습니다.</div><button class="text-link" id="close-review-error">닫기</button></div><p class="run-error">${escapeHtml(state.taskReviewError)}</p></section>`;
  const review = state.taskReview;
  if (!review) return "";
  return `<section class="card review-panel"><div class="panel-header"><div><div class="panel-title">코드 변경 검토 · ${escapeHtml(review.taskId)}</div><div class="panel-description">branch ${escapeHtml(review.branch)} · ${escapeHtml(review.baseCommit.slice(0, 10))} → ${escapeHtml(review.headCommit.slice(0, 10))}</div></div><button class="text-link" id="close-review">닫기</button></div>
    <div class="review-summary"><span class="badge ${review.diffCheckPassed ? "completed" : "failed"}">${review.diffCheckPassed ? "diff 검사 통과" : "diff 검사 실패"}</span><span>${escapeHtml(review.diffStat || "변경 파일 없음")}</span></div>
    ${review.changedFiles.length ? `<div class="changed-files"><strong>변경 파일</strong>${review.changedFiles.map((file) => `<code>${escapeHtml(file)}</code>`).join("")}</div>` : ""}
    ${review.diffCheckOutput ? `<pre class="diff-check">${escapeHtml(review.diffCheckOutput)}</pre>` : ""}
    ${review.diffTruncated ? `<div class="notice warn">Diff 미리보기가 길이 제한으로 일부만 표시됩니다. Task worktree에서 전체 diff를 검토하세요.</div>` : ""}
    <pre class="diff-view">${escapeHtml(review.diff || "표시할 diff가 없습니다.")}</pre>
  </section>`;
}

function renderApprovalArtifact() {
  if (state.approvalLoading) return `<section class="card review-panel"><div class="loading"><span class="spinner"></span><span>승인 문서를 불러옵니다</span></div></section>`;
  const detail = state.approvalArtifact;
  if (!detail) return "";
  const { approval } = detail;
  const linkedRun = state.project?.runs.find((run) => run.id === approval.workflow_run_id);
  const requiresCodeReview = linkedRun?.workflow_id === "feature-delivery";
  const taskReview = state.taskReview?.taskId === approval.task_id ? state.taskReview : null;
  const canApprove = !detail.artifactChanged && (!requiresCodeReview || taskReview?.diffCheckPassed === true);
  return `<section class="card review-panel"><div class="panel-header"><div><div class="panel-title">승인 문서 · ${escapeHtml(approval.action)}</div><div class="panel-description">${escapeHtml(approval.artifact_path)} · Task ${escapeHtml(approval.task_id)}</div></div><button class="text-link" id="close-approval-review">닫기</button></div>
    <div class="notice ${detail.artifactChanged ? "warn" : "info"}"><span>${detail.artifactChanged ? "!" : "✓"}</span><span>${detail.artifactChanged ? "요청 이후 승인 문서가 바뀌었습니다. 기존 요청을 승인할 수 없습니다." : "요청 당시의 문서 hash와 현재 문서가 같습니다."} 승인 결정은 이 문서에 적용됩니다. 코드 diff도 별도로 검토하세요.</span></div>
    <div class="artifact-hash">요청 hash: <code>${escapeHtml(approval.artifact_sha256)}</code><br />현재 hash: <code>${escapeHtml(detail.currentSha256)}</code></div>
    <pre class="diff-view artifact-view">${escapeHtml(detail.content)}</pre>
    ${requiresCodeReview ? `<button class="text-link" data-review-approval-task="${escapeHtml(approval.task_id)}">이 Task의 코드 diff 검토</button>` : ""}
    ${approval.status === "pending" ? `${requiresCodeReview ? (taskReview ? `<label class="review-confirm"><input type="checkbox" id="approval-code-reviewed" />${taskReview.diffTruncated ? "전체 diff를 확인했습니다. 화면 밖의 변경도 확인했습니다." : "코드 diff를 확인했습니다."}</label>` : `<div class="field-help">승인하려면 먼저 이 Task의 코드 diff를 열고 검토하세요.</div>`) : ""}<label class="decision-reason">결정 사유<textarea id="approval-reason" rows="2" maxlength="1000" placeholder="검토한 내용과 결정을 기록하세요."></textarea></label><div class="modal-footer"><button class="button danger-button" id="reject-release">거절</button><button class="button" id="approve-release" ${canApprove ? "" : "disabled"}>승인</button></div>` : `<div class="notice info">이 요청의 상태: ${escapeHtml(approval.status)}</div>`}
  </section>`;
}

function renderKnowledgePanel() {
  if (state.knowledgeLoading) return `<section class="card company-panel"><div class="loading"><span class="spinner"></span><span>Knowledge source와 card를 확인합니다</span></div></section>`;
  const knowledge = state.knowledge;
  if (!knowledge) return `<section class="card company-panel"><div class="panel-title">지식 상태를 불러오지 못했습니다.</div><div class="panel-description">새로고침을 선택하세요.</div></section>`;
  const stateLabel = !knowledge.available ? "자료 없음" : knowledge.qualified ? "검토 통과" : "검토 필요";
  return `<section class="card company-panel"><div class="panel-header"><div><div class="panel-title">검증된 지식 자료</div><div class="panel-description">최근 확인 ${dateLabel(knowledge.checkedAt)} · 유효한 source ${knowledge.validSources.length}개 · Knowledge Card ${knowledge.validCards.length}개</div></div><span class="badge ${knowledge.qualified ? "completed" : "waiting_approval"}">${stateLabel}</span></div>
    ${!knowledge.qualified ? `<div class="notice warn"><span>!</span><span>미검증 또는 만료된 자료는 Agent의 승인된 지식 문맥에 포함되지 않습니다. 출처와 적용 범위를 검토하세요.</span></div>` : `<div class="notice info"><span>✓</span><span>활성 모듈의 검증된 지식 자료가 준비되어 있습니다.</span></div>`}
    <div class="knowledge-columns"><div><div class="knowledge-heading">활성 모듈</div>${knowledge.activeModules.length ? knowledge.activeModules.map((module) => `<div class="knowledge-item"><code>${escapeHtml(module)}</code>${knowledge.coverageGaps.includes(module) ? `<span class="badge blocked">card 부족</span>` : `<span class="badge completed">card 있음</span>`}</div>`).join("") : `<div class="empty-copy">활성 모듈이 없습니다.</div>`}</div><div><div class="knowledge-heading">검증된 source</div>${knowledge.validSources.length ? knowledge.validSources.slice(0, 8).map((source) => `<div class="knowledge-item"><span><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.authority)} · ${escapeHtml(source.module)}</small></span><span class="badge completed">${escapeHtml(source.review_after)}</span></div>`).join("") : `<div class="empty-copy">검증된 source가 없습니다.</div>`}</div></div>
    ${knowledge.validCards.length ? `<div class="knowledge-cards">${knowledge.validCards.slice(0, 8).map((card) => `<article class="knowledge-card"><div class="knowledge-item"><strong>${escapeHtml(card.title)}</strong><span class="badge ${card.risk === "high" ? "blocked" : "ready"}">${escapeHtml(card.risk)} risk</span></div><div class="knowledge-claim">${escapeHtml(card.claim)}</div><div class="knowledge-action"><strong>Action:</strong> ${escapeHtml(card.action)}</div><div class="row-meta">${escapeHtml(card.module)} · review ${escapeHtml(card.review_after)} · 전문가 검토 ${escapeHtml(card.professional_review)}</div></article>`).join("")}</div>` : ""}
    ${knowledge.issues.length ? `<details class="knowledge-issues"><summary>확인이 필요한 항목 ${knowledge.issues.length}개</summary>${knowledge.issues.slice(0, 20).map((item) => `<div class="knowledge-item"><span><strong>${escapeHtml(item.subject)}</strong><small>${escapeHtml(item.message)}</small></span><span class="badge">${escapeHtml(item.code)}</span></div>`).join("")}</details>` : ""}
    <div class="panel-footer"><span class="panel-description">Knowledge source: <code>knowledge/sources/manifest.yaml</code> · Cards: <code>knowledge/cards/</code></span><button class="text-link" id="refresh-knowledge">다시 확인</button></div>
  </section>`;
}

async function openTaskReview(taskId) {
  if (state.taskReviewLoading) return;
  const projectRoot = state.project?.root;
  state.taskReviewLoading = taskId;
  state.taskReviewError = null;
  state.taskReview = null;
  render();
  try {
    const review = await window.founderDesk.getTaskReview(taskId);
    if (state.project?.root === projectRoot) state.taskReview = review;
  } catch (error) {
    if (state.project?.root === projectRoot) {
      state.taskReviewError = error instanceof Error ? error.message : String(error);
      toast(state.taskReviewError, true);
    }
  } finally {
    if (state.project?.root === projectRoot) {
      state.taskReviewLoading = null;
      render();
    }
  }
}

async function openApprovalArtifact(approvalId) {
  if (state.approvalLoading) return;
  const projectRoot = state.project?.root;
  state.approvalLoading = approvalId;
  state.approvalArtifact = null;
  render();
  try {
    const artifact = await window.founderDesk.getApprovalArtifact(approvalId);
    if (state.project?.root === projectRoot) state.approvalArtifact = artifact;
  } catch (error) {
    if (state.project?.root === projectRoot) toast(error instanceof Error ? error.message : String(error), true);
  } finally {
    if (state.project?.root === projectRoot) {
      state.approvalLoading = null;
      render();
    }
  }
}

async function decideApproval(decision) {
  const detail = state.approvalArtifact;
  const reason = document.querySelector("#approval-reason")?.value || "";
  if (!detail) return;
  if (decision === "approve") {
    const linkedRun = state.project?.runs.find((run) => run.id === detail.approval.workflow_run_id);
    const requiresCodeReview = linkedRun?.workflow_id === "feature-delivery";
    if (requiresCodeReview && (!state.taskReview || state.taskReview.taskId !== detail.approval.task_id || !state.taskReview.diffCheckPassed)) {
      toast("승인 전에 Task의 코드 diff를 열고 diff 검사를 확인하세요.", true);
      return;
    }
    if (requiresCodeReview && !document.querySelector("#approval-code-reviewed")?.checked) {
      toast("승인 전에 코드 diff 검토를 확인하세요.", true);
      return;
    }
  }
  if (!reason.trim()) {
    toast("승인 또는 거절 사유를 입력하세요.", true);
    return;
  }
  const result = await withBusy("승인 결정을 저장하고 있습니다", () => window.founderDesk.decideApproval(detail.approval.id, decision, reason));
  if (result) {
    state.approvalArtifact = null;
    render();
    toast(decision === "approve" ? "승인을 기록했습니다." : "거절을 기록했습니다.");
  }
}

function openIdeaDialog() {
  if (document.querySelector("#idea-modal")) return;
  state.activeNav = "ideas";
  render();
  const modal = document.createElement("div");
  modal.id = "idea-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="idea-title">
      <div class="modal-top"><div><div class="eyebrow">Idea validation</div><h2 id="idea-title">어떤 문제를 해결하려고 하나요?</h2></div><button class="icon-button" id="close-idea" aria-label="닫기">×</button></div>
      <p class="panel-description modal-description">Agent 팀이 고객 문제, 위험한 가정, 가격·비용과 검증 실험을 정리합니다. 외부 연락이나 결제는 하지 않습니다.</p>
      <form id="idea-form" class="idea-form">
        <label>아이디어를 한 문장으로 적어주세요<input name="objective" maxlength="180" required placeholder="예: 프리랜서를 위한 간단한 세금 준비 도구" /></label>
        <label>고객이 겪는 문제<textarea name="problem" rows="4" maxlength="3000" required placeholder="현재 어떤 상황에서 불편을 겪고 있나요? 직접 들은 말이나 관찰한 내용을 적어주세요."></textarea></label>
        <label>누가 이 문제를 겪나요?<input name="targetCustomer" maxlength="300" required placeholder="예: 한국에서 일하는 1인 프리랜서" /></label>
        <div class="modal-footer"><button type="button" id="cancel-idea" class="button secondary">취소</button><button type="submit" class="button">검증 시작 <span>→</span></button></div>
      </form>
    </section>`;
  document.body.append(modal);
  const close = () => { modal.remove(); render(); };
  document.querySelector("#close-idea").addEventListener("click", close);
  document.querySelector("#cancel-idea").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.querySelector("#idea-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = {
      objective: String(values.get("objective") || ""),
      problem: String(values.get("problem") || ""),
      targetCustomer: String(values.get("targetCustomer") || ""),
    };
    close();
    const started = await withBusy("아이디어 검증 Task를 만들고 있습니다", () => window.founderDesk.startIdeaValidation(input));
    if (started) toast("아이디어 검증을 시작했습니다. Agent 결과가 이 화면에 순서대로 표시됩니다.");
  });
}

function openFeatureDialog() {
  if (document.querySelector("#idea-modal")) return;
  state.activeNav = "build";
  render();
  const modal = document.createElement("div");
  modal.id = "idea-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card wide-modal" role="dialog" aria-modal="true" aria-labelledby="feature-title">
      <div class="modal-top"><div><div class="eyebrow">Feature delivery</div><h2 id="feature-title">Agent가 바꿀 범위를 정해주세요.</h2></div><button class="icon-button" id="close-idea" aria-label="닫기">×</button></div>
      <p class="panel-description modal-description">Agent는 Task 전용 Git worktree에서 구현합니다. Harness는 쓰기 범위를 검사합니다. commit, merge, 배포는 직접 검토한 뒤 진행하세요.</p>
      <form id="feature-form" class="idea-form">
        <label>기능 목표<input name="objective" maxlength="180" required placeholder="예: 스톱워치 기록을 초기화할 수 있다" /></label>
        <label>필요한 동작과 배경<textarea name="problem" rows="3" maxlength="3000" required placeholder="사용자 상황과 기대 동작을 적어주세요."></textarea></label>
        <label>수정 가능한 파일 경로<textarea name="writablePaths" rows="2" required placeholder="한 줄에 하나씩 입력합니다. 예: src/**"></textarea><span class="field-help">필요한 최소 폴더를 입력하세요. 예: src/components/**</span></label>
        <label>완료 조건<textarea name="acceptance" rows="3" required placeholder="한 줄에 하나씩 입력합니다. 예: 시작 버튼을 누르면 시간이 증가한다."></textarea></label>
        <fieldset class="risk-choices"><legend>관련 위험을 선택하세요.</legend>${[["security", "보안"], ["personal-data", "개인정보"], ["payments", "결제"], ["authentication", "인증"], ["database", "데이터베이스"], ["network", "네트워크"]].map(([value, label]) => `<label><input type="checkbox" name="riskFlags" value="${value}" />${label}</label>`).join("")}</fieldset>
        <div class="notice info"><span>i</span><span>프로젝트 Git 저장소가 깨끗할 때 시작할 수 있습니다. 변경 전 상태를 보존하고 Task별 branch를 만듭니다.</span></div>
        <div class="modal-footer"><button type="button" id="cancel-idea" class="button secondary">취소</button><button type="submit" class="button">계획과 구현 시작 <span>→</span></button></div>
      </form>
    </section>`;
  document.body.append(modal);
  const close = () => { modal.remove(); render(); };
  document.querySelector("#close-idea").addEventListener("click", close);
  document.querySelector("#cancel-idea").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.querySelector("#feature-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const lines = (key) => String(values.get(key) || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const input = {
      objective: String(values.get("objective") || ""),
      problem: String(values.get("problem") || ""),
      writablePaths: lines("writablePaths"),
      acceptance: lines("acceptance"),
      riskFlags: [...event.currentTarget.querySelectorAll('input[name="riskFlags"]:checked')].map((item) => item.value),
    };
    close();
    const started = await withBusy("제품 개발 Task와 전용 worktree를 준비합니다", () => window.founderDesk.startFeatureDelivery(input));
    if (started) toast("제품 개발 workflow를 시작했습니다. 계획·구현·검토 결과를 이 화면에서 확인하세요.");
  });
}

function openOperationalDialog(workflowId) {
  if (document.querySelector("#idea-modal")) return;
  const definitions = {
    "weekly-operations": {
      nav: "overview",
      title: "이번 주에 무엇이 달라졌나요?",
      objectiveLabel: "주간 요약 이름",
      objectivePlaceholder: "예: 11월 둘째 주 운영 검토",
      contextLabel: "이번 주 고객·제품·현금·위험 변화",
      contextPlaceholder: "지표, 고객 의견, 운영 변경, 현금 흐름, 미해결 위험을 적어주세요.",
      button: "주간 검토 시작",
    },
    "monthly-close": {
      nav: "finance",
      title: "이번 달의 재무 자료를 정리하세요.",
      objectiveLabel: "월 또는 검토 기간",
      objectivePlaceholder: "예: 2026년 11월 마감 검토",
      contextLabel: "매출·비용·현금·runway와 증빙 상태",
      contextPlaceholder: "수입, 지출, 현금 잔액, 임박한 납부, 자료가 없는 항목을 적어주세요.",
      button: "월간 검토 시작",
    },
    incident: {
      nav: "risk",
      title: "무슨 일이 있었나요?",
      objectiveLabel: "사건 이름",
      objectivePlaceholder: "예: 로그인 오류로 고객 접근이 중단됨",
      contextLabel: "시간, 시스템, 고객·데이터 영향과 현재 증거",
      contextPlaceholder: "관찰된 사실, 예상 영향, 이미 한 조치, 모르는 내용을 구분해 적어주세요.",
      button: "사건 검토 시작",
    },
  }[workflowId];
  if (!definitions) return;
  state.activeNav = definitions.nav;
  render();
  const modal = document.createElement("div");
  modal.id = "idea-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card wide-modal" role="dialog" aria-modal="true" aria-labelledby="operational-title">
      <div class="modal-top"><div><div class="eyebrow">${escapeHtml(workflowId)}</div><h2 id="operational-title">${escapeHtml(definitions.title)}</h2></div><button class="icon-button" id="close-idea" aria-label="닫기">×</button></div>
      <p class="panel-description modal-description">Agent는 제공한 자료를 요약하고 결정 항목을 준비합니다. 주민등록번호, 계좌번호, 비밀번호, 고객 식별자는 입력하지 마세요. 고객 연락이나 결제·운영·배포 조치는 실행하지 않습니다.</p>
      <form id="operational-form" class="idea-form">
        <label>${escapeHtml(definitions.objectiveLabel)}<input name="objective" maxlength="180" required placeholder="${escapeHtml(definitions.objectivePlaceholder)}" /></label>
        <label>${escapeHtml(definitions.contextLabel)}<textarea name="context" rows="6" maxlength="5000" required placeholder="${escapeHtml(definitions.contextPlaceholder)}"></textarea></label>
        ${workflowId === "incident" ? `<fieldset class="risk-choices"><legend>관련된 영향 유형을 선택하세요.</legend>${[["security", "보안"], ["personal-data", "개인정보"], ["payments", "결제"], ["authentication", "인증"], ["database", "데이터베이스"], ["network", "네트워크"]].map(([value, label]) => `<label><input type="checkbox" name="riskFlags" value="${value}" />${label}</label>`).join("")}</fieldset>` : ""}
        <div class="notice info"><span>i</span><span>자료를 제공하지 않은 영역은 추정하지 않도록 Agent에 지시합니다. 민감한 고객 정보나 인증 정보를 입력하지 마세요.</span></div>
        <div class="modal-footer"><button type="button" id="cancel-idea" class="button secondary">취소</button><button type="submit" class="button">${escapeHtml(definitions.button)} <span>→</span></button></div>
      </form>
    </section>`;
  document.body.append(modal);
  const close = () => { modal.remove(); render(); };
  document.querySelector("#close-idea").addEventListener("click", close);
  document.querySelector("#cancel-idea").addEventListener("click", close);
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.querySelector("#operational-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = {
      workflowId,
      objective: String(values.get("objective") || ""),
      context: String(values.get("context") || ""),
      riskFlags: [...event.currentTarget.querySelectorAll('input[name="riskFlags"]:checked')].map((item) => item.value),
    };
    close();
    const started = await withBusy("운영 Task와 Agent workflow를 준비합니다", () => window.founderDesk.startOperationalWorkflow(input));
    if (started) toast("운영 검토를 시작했습니다. Agent 결과가 Workflow 기록에 표시됩니다.");
  });
}

async function openKnowledgePanel() {
  if (state.knowledgeLoading) return;
  const projectRoot = state.project?.root;
  state.activeNav = "knowledge";
  state.knowledgeLoading = true;
  render();
  try {
    const knowledge = await window.founderDesk.inspectKnowledge();
    if (state.project?.root === projectRoot) state.knowledge = knowledge;
  } catch (error) {
    if (state.project?.root === projectRoot) toast(error instanceof Error ? error.message : String(error), true);
  } finally {
    if (state.project?.root === projectRoot) {
      state.knowledgeLoading = false;
      render();
    }
  }
}

function syncWorkflowPolling(snapshot) {
  const isRunning = snapshot.runs.some((run) => run.status === "running");
  if (isRunning && !state.pollTimer) {
    state.pollTimer = setInterval(async () => {
      if (state.busy || !state.project) return;
      try {
        state.project = await window.founderDesk.refreshProject();
        render();
      } catch (error) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        toast(error instanceof Error ? error.message : String(error), true);
      }
    }, 4000);
  } else if (!isRunning && state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function render() {
  if (!state.project) renderWelcome();
  else if (!state.project.initialized) runtimeSetup(state.project);
  else renderDashboard(state.project);
}

async function withBusy(label, operation) {
  if (state.busy) return;
  const previousRoot = state.project?.root;
  state.busy = true;
  app.innerHTML = `<div class="boot-screen"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
  try {
    const result = await operation();
    if (result) {
      if (previousRoot && previousRoot !== result.root) {
        state.taskReview = null;
        state.taskReviewError = null;
        state.taskReviewLoading = null;
        state.approvalArtifact = null;
        state.approvalLoading = null;
        state.knowledge = null;
        state.knowledgeLoading = false;
        state.activeNav = "overview";
      }
      state.project = result;
    }
    state.recent = await window.founderDesk.getRecentProjects();
    render();
    return result;
  } catch (error) {
    render();
    toast(error instanceof Error ? error.message : String(error), true);
  } finally {
    state.busy = false;
  }
}

async function openProject() {
  return withBusy("프로젝트를 불러오고 있습니다", () => window.founderDesk.selectProject());
}

async function openRecent(index) {
  return withBusy("프로젝트를 불러오고 있습니다", () => window.founderDesk.openRecentProject(index));
}

async function refreshProject() {
  return withBusy("상태를 새로고침하고 있습니다", () => window.founderDesk.refreshProject());
}

async function initializeProject() {
  const selected = document.querySelector('input[name="runtime"]:checked');
  if (!selected) {
    toast("사용할 Coding Agent를 선택하세요.", true);
    return;
  }
  return withBusy("Harness를 초기화하고 있습니다", () => window.founderDesk.initializeProject(selected.value));
}

async function saveRuntime() {
  const selected = document.querySelector('input[name="runtime"]:checked');
  if (!selected) {
    toast("사용할 Coding Agent를 선택하세요.", true);
    return;
  }
  return withBusy("Runtime 설정을 저장하고 있습니다", () => window.founderDesk.setRuntime(selected.value));
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    state.recent = await window.founderDesk.getRecentProjects();
    renderWelcome();
  } catch (error) {
    app.innerHTML = `<div class="welcome-wrap"><div class="error-card">데스크탑 앱을 시작하지 못했습니다.<br />${escapeHtml(error instanceof Error ? error.message : String(error))}</div></div>`;
  }
});
