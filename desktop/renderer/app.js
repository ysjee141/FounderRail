const app = document.querySelector("#app");
const state = { project: null, recent: [], busy: false, pollTimer: null };

const runtimeNames = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

const statusNames = {
  draft: "초안",
  ready: "준비됨",
  running: "실행 중",
  blocked: "확인 필요",
  in_review: "검토 중",
  waiting_approval: "승인 대기",
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
        <button class="nav-item" data-nav="ideas"><span class="icon">✳</span>사업 검증</button>
        <button class="nav-item" data-nav="build" disabled title="다음 단계에서 연결합니다"><span class="icon">⌘</span>제품 개발</button>
      </nav>
      <div class="nav-label spaced">Company</div>
      <nav class="nav-list">
        <button class="nav-item" data-nav="knowledge" disabled title="다음 단계에서 연결합니다"><span class="icon">▤</span>지식 자료</button>
        <button class="nav-item" data-nav="finance" disabled title="다음 단계에서 연결합니다"><span class="icon">◉</span>재무</button>
        <button class="nav-item" data-nav="risk" disabled title="다음 단계에서 연결합니다"><span class="icon">◇</span>보안과 위험</button>
      </nav>
      <div class="sidebar-bottom"><div class="runtime-chip"><span class="runtime-dot"></span>${escapeHtml(runtime)}</div><div class="runtime-caption">현재 프로젝트 Runtime</div></div>
    </aside>`;
}

function taskRows(tasks) {
  if (!tasks.length) return `<div class="empty-state"><div class="empty-mark">＋</div><div class="empty-title">아직 작업이 없습니다.</div><div class="empty-copy">사업 검증이나 기능 개발 Task를 시작해보세요.</div></div>`;
  return `<div class="task-list">${tasks.slice(0, 5).map((task) => `
    <div class="task-row"><div class="row-primary"><div class="row-title">${escapeHtml(task.objective)}</div><div class="row-meta">${escapeHtml(task.id)} · ${escapeHtml(task.owner_agent)} · ${dateLabel(task.updated_at)}</div></div>${badge(task.status)}</div>`).join("")}</div>`;
}

function runRows(runs) {
  if (!runs.length) return `<div class="empty-state"><div class="empty-mark">↗</div><div class="empty-title">실행 기록이 없습니다.</div><div class="empty-copy">workflow 실행 결과가 이곳에 표시됩니다.</div></div>`;
  return `<div class="run-list">${runs.slice(0, 5).map((run) => `
    <div class="run-row"><div class="row-primary"><div class="row-title">${escapeHtml(run.workflow_id)}</div><div class="row-meta">${escapeHtml(run.id)} · ${escapeHtml(run.task_id)} · ${dateLabel(run.updated_at)}</div><div class="row-meta">단계 ${run.steps.filter((step) => ["completed", "skipped"].includes(step.status)).length}/${run.steps.length} 완료${run.status === "running" ? ` · ${escapeHtml(run.steps.find((step) => step.status === "running")?.step_id || "준비 중")}` : ""}</div>${run.steps.find((step) => step.error)?.error ? `<div class="run-error">${escapeHtml(run.steps.find((step) => step.error).error)}</div>` : ""}</div>${badge(run.status)}</div>`).join("")}</div>`;
}

function renderDashboard(snapshot) {
  const activeRuns = snapshot.runs.filter((run) => ["running", "blocked", "waiting_approval"].includes(run.status)).length;
  const completedTasks = snapshot.tasks.filter((task) => task.status === "completed").length;
  const approvals = snapshot.approvals.length;
  const selectedRuntime = snapshot.runtimes.find((runtime) => runtime.name === snapshot.runtime);
  const gitMessage = snapshot.git.isRepository
    ? `현재 브랜치 ${escapeHtml(snapshot.git.branch || "detached")}`
    : "Git 저장소를 연결하면 코드 변경을 검토할 수 있습니다.";

  app.innerHTML = `
    <div class="app-shell">
      ${sidebar(snapshot, "overview")}
      <main class="main-area">
        <div class="topbar"><div class="crumb">Workspace <span> / </span><strong>${escapeHtml(snapshot.name)}</strong></div><div class="top-actions"><button class="button secondary" id="open-another">프로젝트 전환</button><button class="icon-button" id="refresh" aria-label="새로고침">↻</button><div class="avatar">나</div></div></div>
        <div class="page-head"><div><div class="eyebrow">Your company workspace</div><h1>좋은 아침입니다.</h1><p class="subtitle">사업 가설, 제품 작업, Agent 팀의 진행 상황을 이곳에서 확인하세요.</p></div><div class="head-actions"><button class="button secondary" id="setup-button">프로젝트 설정</button><button class="button" id="new-idea">아이디어 검증 시작 <span>→</span></button></div></div>
        ${selectedRuntime?.available ? "" : `<div class="notice warn"><span>!</span><span>선택한 Runtime을 찾을 수 없습니다. 프로젝트 설정에서 설치된 CLI를 선택하세요.</span></div>`}
        ${!snapshot.git.isRepository ? `<div class="notice warn"><span>!</span><span>${gitMessage}</span></div>` : ""}
        ${approvals ? `<div class="approval-banner"><div class="approval-left"><span class="approval-icon">!</span><span><span class="approval-title">검토가 필요한 승인 요청 ${approvals}건</span><span class="approval-copy">승인 검토 화면은 다음 작업 단계에서 연결합니다.</span></span></div><button class="button secondary" id="refresh-approvals">새로고침</button></div>` : ""}
        <div class="grid">
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">전체 Task</span><span class="stat-icon">▤</span></div><div class="stat-value">${snapshot.tasks.length}</div><div class="stat-foot">${completedTasks}건 완료</div></section>
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">진행 중인 Workflow</span><span class="stat-icon">↗</span></div><div class="stat-value">${activeRuns}</div><div class="stat-foot">실행, 확인 또는 승인 대기</div></section>
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">승인 대기</span><span class="stat-icon">✓</span></div><div class="stat-value">${approvals}</div><div class="stat-foot">${snapshot.runtime ? escapeHtml(runtimeNames[snapshot.runtime]) : "Runtime 미설정"}</div></section>
          <section class="card stat-card"><div class="stat-top"><span class="stat-label">Git 상태</span><span class="stat-icon">⌘</span></div><div class="stat-value compact">${snapshot.git.isRepository ? (snapshot.git.clean ? "Clean" : "변경 있음") : "미연결"}</div><div class="stat-foot">${gitMessage}</div></section>
          <section class="card panel"><div class="panel-header"><div><div class="panel-title">최근 작업</div><div class="panel-description">Task 상태와 담당 Agent</div></div><button class="text-link" id="refresh-tasks">새로고침</button></div>${taskRows(snapshot.tasks)}</section>
          <section class="card panel side-panel"><div class="panel-header"><div><div class="panel-title">Workflow 기록</div><div class="panel-description">Agent 단계와 승인 진행 상황</div></div><button class="text-link" id="refresh-runs">새로고침</button></div>${runRows(snapshot.runs)}</section>
          <section class="card panel"><div class="panel-header"><div><div class="panel-title">최근 Agent 결과</div><div class="panel-description">Agent가 다음 작업자에게 전달한 요약</div></div></div>${handoffRows(snapshot.handoffs)}</section>
          <section class="card panel side-panel"><div class="panel-header"><div><div class="panel-title">사용 가능한 Agent</div><div class="panel-description">선택한 Runtime으로 역할을 실행합니다</div></div><span class="badge ready">${escapeHtml(runtimeNames[snapshot.runtime] ?? "설정 필요")}</span></div><div class="grid agent-grid">${snapshot.agents.slice(0, 6).map((agent) => `<div class="card agent-card"><div class="agent-name">${escapeHtml(agent.name)}</div><div class="agent-description">${escapeHtml(agent.description)}</div></div>`).join("")}</div></section>
          <section class="card panel"><div class="panel-header"><div><div class="panel-title">시작할 Workflow</div><div class="panel-description">이 프로젝트에서 사용할 수 있는 작업 흐름</div></div></div><div class="task-list">${snapshot.workflows.map((workflow) => `<div class="task-row"><div><div class="row-title">${escapeHtml(workflow.name)}</div><div class="row-meta">${escapeHtml(workflow.description)}</div></div><span class="badge">${workflow.stepCount}단계</span></div>`).join("")}</div></section>
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
  document.querySelectorAll('[data-nav="ideas"]').forEach((button) => button.addEventListener("click", openIdeaDialog));
  syncWorkflowPolling(snapshot);
}

function handoffRows(handoffs) {
  if (!handoffs?.length) return `<div class="empty-state compact-empty"><div class="empty-mark">↗</div><div class="empty-title">아직 전달된 결과가 없습니다.</div><div class="empty-copy">아이디어 검증을 실행하면 Agent별 분석이 여기에 표시됩니다.</div></div>`;
  return `<div class="handoff-list">${handoffs.slice(-6).reverse().map((handoff) => `
    <article class="handoff-row"><div class="handoff-head"><div><div class="row-title">${escapeHtml(handoff.agent_id)} · ${escapeHtml(handoff.task_id)}</div><div class="row-meta">${dateLabel(handoff.created_at)}</div></div>${badge(handoff.status)}</div><p class="handoff-summary">${escapeHtml(handoff.summary)}</p>${handoff.decisions?.length ? `<div class="handoff-points"><strong>결정 항목</strong><ul>${handoff.decisions.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}${handoff.risks?.length ? `<div class="handoff-risk">남은 위험: ${escapeHtml(handoff.risks.slice(0, 2).join(" · "))}</div>` : ""}</article>`).join("")}</div>`;
}

function openIdeaDialog() {
  if (document.querySelector("#idea-modal")) return;
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
  const close = () => modal.remove();
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
  state.busy = true;
  app.innerHTML = `<div class="boot-screen"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
  try {
    const result = await operation();
    if (result) state.project = result;
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
