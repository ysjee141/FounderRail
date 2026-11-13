# Founder Desk 데스크탑 앱

Founder Desk는 Agent-Team Harness를 화면에서 시작하고 살펴보는 로컬 데스크탑 앱입니다. 프로젝트마다 Coding Agent CLI 하나를 선택합니다. 저장소에서 실행할 때는 Node.js 22.13 이상을 사용하세요.

## 시작하기

저장소를 내려받고 의존성을 설치한 뒤 앱을 실행합니다.

```bash
npm install
npm run desktop
```

Linux용 배포 파일은 다음 명령으로 만듭니다. `out/make`에 `.deb` 설치 파일과 zip 파일이 생성됩니다.

```bash
npm run make:desktop:linux
```

Windows와 macOS에서는 각 운영체제에서 `npm run make:desktop`을 실행해 실행 앱을 담은 zip 파일을 만듭니다. Linux 패키징에는 `dpkg`와 `fakeroot`가 필요합니다. 목표 운영체제에서 패키징하세요. `.deb` 메타데이터의 maintainer 주소는 개발용 placeholder입니다. 외부에 배포하기 전에 프로젝트 정보로 변경하세요.

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

## 사업 운영과 지식 상태

- **주간 운영**은 고객·제품·현금·위험 자료를 모아 창업자 결정 항목을 준비합니다.
- **월간 마감**은 매출·비용·현금·runway와 자료 공백을 정리합니다.
- **사건 검토**는 기술·고객·데이터 영향을 나누고 사람의 결정을 준비합니다.
- **지식 자료**는 프로젝트 Knowledge Card와 source manifest를 검사합니다. 만료되거나 검증되지 않은 source와 module coverage gap을 보여줍니다.

업무 입력은 프로젝트의 `.agent-team/state.db`에 저장됩니다. 주민등록번호, 계좌번호, 비밀번호와 고객 식별자는 입력하지 마세요. 필요한 경우 합계 또는 가명 자료를 사용하세요. 이 화면은 지식 source를 수집하거나 검증 상태로 바꾸지 않습니다.

## Agent 실행과 데이터 위치

앱에 포함된 `agents/`, `workflows/`, `schemas/` 정의를 사용합니다. 실제 프로젝트의 회사 문서와 지식 자료는 선택한 프로젝트 폴더에서 읽습니다. Task, Handoff, Workflow 실행은 선택한 프로젝트의 `.agent-team/state.db`에 저장합니다.

Agent 실행은 선택한 CLI를 로컬 subprocess로 호출합니다. Harness는 각 Agent에 읽기·쓰기 경계와 금지 행동을 전달하며, 아이디어 검증 단계는 읽기 전용으로 실행합니다. 앱은 CLI 인증 정보를 수집하거나 대신 보관하지 않습니다.

## 현재 범위

현재 화면에서 할 수 있는 일은 프로젝트 초기화, Runtime 선택, 아이디어 검증, Feature Delivery, 주간 운영, 월간 마감, 사건 검토, Knowledge 상태 확인, Task·Workflow 상태 확인, Git diff 검토와 Release 승인 기록입니다. 지식 편집, 회계 시스템 연동, merge와 배포는 앱에서 실행하지 않습니다.
