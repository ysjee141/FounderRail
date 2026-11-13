# Solo Founder Agent Team

Claude Code, Codex 또는 Gemini CLI 중 하나를 선택해 동일한 1인 창업 Agent-Team을 실행하는 로컬 Harness입니다.

현재 구현 범위는 Runtime foundation입니다.

```bash
npm install
npm run build
npm link

team doctor
team init --runtime codex
team runtime set claude
team bootstrap status
team agents
team ask finance-ops "이번 달 runway 계산에 필요한 자료를 정리해줘" --dry-run
team task create --owner product-growth --objective "고객 문제를 검증한다" --why "구현 전 가장 위험한 가정을 확인한다"
team workflow inspect idea-validation
team run --prompt "현재 저장소의 상태를 한 문단으로 요약해줘"
```

Runtime 실행 이벤트는 `.agent-team/events/<run-id>.jsonl`에 저장됩니다. 기본 실행 모드는 `read-only`이며, 명시적으로 `--mode workspace-write`를 전달해야 파일을 변경할 수 있습니다.

`team init`은 기존 파일을 덮어쓰지 않고 `company/`, `knowledge/`, `work/`의 시작 템플릿을 생성합니다. `company/profile.yaml`의 `undecided` 항목을 실제 사업과 제품 정보로 채운 뒤 `team bootstrap status`로 필요한 지식 모듈과 overlay를 확인합니다.

Task와 Handoff는 `.agent-team/state.db`에 저장됩니다. Task 상태는 정의된 상태 머신을 통해서만 변경되며, Handoff는 Agent 결과 schema를 통과한 불변 기록입니다.

Workflow는 `workflows/*.yaml`에 정의합니다. loader는 dependency와 cycle을 검증하며, 실행기는 이전 단계의 전체 대화 대신 검증된 Handoff만 다음 Agent에 전달합니다.

전체 설계와 단계별 구현 계획은 [agent-team-harness-plan.md](./agent-team-harness-plan.md)를 참고합니다.
