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

## Agent 실행과 데이터 위치

앱에 포함된 `agents/`, `workflows/`, `schemas/` 정의를 사용합니다. 실제 프로젝트의 회사 문서와 지식 자료는 선택한 프로젝트 폴더에서 읽습니다. Task, Handoff, Workflow 실행은 선택한 프로젝트의 `.agent-team/state.db`에 저장합니다.

Agent 실행은 선택한 CLI를 로컬 subprocess로 호출합니다. Harness는 각 Agent에 읽기·쓰기 경계와 금지 행동을 전달하며, 아이디어 검증 단계는 읽기 전용으로 실행합니다. 앱은 CLI 인증 정보를 수집하거나 대신 보관하지 않습니다.

## 현재 범위

현재 화면에서 할 수 있는 일은 프로젝트 초기화, Runtime 선택, 아이디어 검증 실행, Task·Workflow 상태 확인과 Agent 결과 읽기입니다. 제품 구현, Git diff 검토, 승인 결정과 배포 작업은 CLI 절차를 사용합니다. 해당 작업은 데스크탑 앱의 후속 단계에서 연결합니다.
