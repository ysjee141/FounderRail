# Founder Desk 데스크탑 앱

Founder Desk는 Agent-Team Harness를 화면에서 시작하고 살펴보는 로컬 데스크탑 앱입니다. 프로젝트마다 Coding Agent CLI 하나를 선택합니다.

## 시작하기

저장소를 내려받고 의존성을 설치한 뒤 앱을 실행합니다.

```bash
npm install
npm run desktop
```

## 프로젝트 열기

1. **프로젝트 폴더 열기**를 선택합니다.
2. Claude Code, Codex, Gemini CLI 중 설치와 인증이 끝난 CLI 하나를 선택합니다.
3. **Harness 초기화**를 선택합니다.
4. 제품 또는 사업 정보를 묻는 화면은 프로젝트를 먼저 검토한 뒤 작성합니다.

앱은 `.agent-team/config.json`에 선택한 Runtime을 기록합니다. Task와 Workflow 상태는 `.agent-team/state.db`에 기록합니다. 기존 프로젝트 파일을 덮어쓰지 않습니다.

## 아이디어 검증 실행

1. **아이디어 검증 시작**을 선택합니다.
2. 아이디어, 고객 문제, 대상 고객을 입력합니다.
3. **검증 시작**을 선택합니다.
4. 대시보드에서 Workflow 단계와 Agent별 Handoff를 확인합니다.

Idea Validation workflow는 제품·고객, 가격·비용, 창업자 결정을 차례로 검토합니다. Agent 결과는 사업 결정을 돕는 초안입니다. 고객 인터뷰나 시장 자료와 함께 검토하세요.

## 제품 기능 작업

제품 개발을 시작하기 전에 프로젝트를 Git 저장소로 만들고 변경사항을 commit합니다. 대시보드의 Git 상태가 `Clean`일 때 **제품 개발 시작**을 선택합니다.

1. 목표와 기대 동작을 작성합니다.
2. Agent가 수정할 수 있는 상대 경로를 입력합니다. 폴더 전체는 `src/**`와 같이 적습니다.
3. 완료 조건을 한 줄씩 작성합니다.
4. 관련된 보안·개인정보·결제 위험을 선택합니다.
5. **계획과 구현 시작**을 선택합니다.

Feature Delivery workflow는 제품 명세, Engineering 계획, 구현, Engineering 검토를 실행합니다. Risk flag를 선택하면 Risk 검토도 실행합니다. Engineering은 Task 전용 worktree와 branch에서 동작합니다.

구현 뒤 Workflow 기록에서 **변경 검토**를 선택합니다. 파일 목록, `git diff --check` 결과와 diff를 읽습니다. 화면은 긴 diff 일부를 생략할 수 있습니다. 생략 표시가 나오면 Task worktree에서 전체 diff를 확인합니다.

Release 승인 요청은 승인 문서와 코드 diff를 각각 보여줍니다. 승인 hash는 release checklist에 적용됩니다. diff도 직접 확인한 뒤 이유를 입력하고 승인 또는 거절을 선택합니다. 승인 결정은 merge나 배포를 실행하지 않습니다.

## Agent 실행과 데이터 위치

앱에 포함된 `agents/`, `workflows/`, `schemas/` 정의를 사용합니다. 실제 프로젝트의 회사 문서와 지식 자료는 선택한 프로젝트 폴더에서 읽습니다. Task, Handoff, Workflow 실행은 선택한 프로젝트의 `.agent-team/state.db`에 저장합니다.

Agent 실행은 선택한 CLI를 로컬 subprocess로 호출합니다. Harness는 각 Agent에 읽기·쓰기 경계와 금지 행동을 전달하며, 아이디어 검증 단계는 읽기 전용으로 실행합니다. 앱은 CLI 인증 정보를 수집하거나 대신 보관하지 않습니다.

## 현재 범위

현재 화면에서 할 수 있는 일은 프로젝트 초기화, Runtime 선택, 아이디어 검증, Feature Delivery 실행, Task·Workflow 상태 확인, Git diff 검토와 Release 승인 기록입니다. 앱은 merge와 배포를 실행하지 않습니다. 지식 자료, 재무 관리와 보안 관리 화면은 아직 연결하지 않았습니다.
