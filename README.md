# Solo Founder Agent Team

Claude Code, Codex 또는 Gemini CLI 중 하나를 선택해 동일한 1인 창업 Agent-Team을 실행하는 로컬 Harness입니다.

현재 구현 범위는 안전 경계, 영속 Task·Handoff, workflow 실행 기반과 Runtime 결과 계약까지입니다.

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
team workflow run idea-validation --task TASK-EXAMPLE
team workflow list --task TASK-EXAMPLE
team workflow resume RUN-EXAMPLE
team inbox
team worktree create TASK-EXAMPLE
team risk classify src/auth/session.ts infra/terraform/main.tf
team finance runway --cash 12000000 --revenue 1000000 --expenses 3000000
team run --prompt "현재 저장소의 상태를 한 문단으로 요약해줘"
```

Runtime 실행 이벤트는 `.agent-team/events/<run-id>.jsonl`에 저장됩니다. 기본 실행 모드는 `read-only`이며, 명시적으로 `--mode workspace-write`를 전달해야 파일을 변경할 수 있습니다.

`team ask`는 Claude·Codex·Gemini의 서로 다른 스트리밍 프로토콜에서 최종 응답을 추출한 뒤 공통 Agent Result schema로 다시 검증합니다. Claude와 Codex에는 각 CLI의 native structured-output 옵션도 전달하며, 잘못된 JSONL·실패 종료·계약 밖 필드는 성공으로 취급하지 않습니다.

`team init`은 기존 파일을 덮어쓰지 않고 `company/`, `knowledge/`, `work/`의 시작 템플릿을 생성합니다. `company/profile.yaml`의 `undecided` 항목을 실제 사업과 제품 정보로 채운 뒤 `team bootstrap status`로 필요한 지식 모듈과 overlay를 확인합니다.

전문 지식은 source manifest와 원문 hash, 적용 조건이 있는 Knowledge Card로 관리합니다. `team knowledge check`와 `team knowledge compile`을 통과한 fresh·verified Card만 지정된 Agent context에 들어가며, active module의 지식 공백은 qualification 실패로 표시됩니다.

Task와 Handoff는 `.agent-team/state.db`에 저장됩니다. Task 상태는 정의된 상태 머신을 통해서만 변경되며, Handoff는 Agent 결과 schema를 통과한 불변 기록입니다.

Workflow는 `workflows/*.yaml`에 정의합니다. loader는 dependency와 cycle을 검증하며, 실행기는 이전 단계의 전체 대화 대신 검증된 Handoff만 다음 Agent에 전달합니다.

Workflow 실행 상태는 Task와 함께 SQLite에 저장됩니다. 실패·중단 뒤 `team workflow list`로 run을 찾고 `team workflow resume`으로 이어가면 완료된 step은 다시 실행하지 않습니다. 시작 후 YAML 정의가 바뀐 run은 digest 검증에 실패하므로 새 정의에 묵시적으로 이어 붙지 않습니다.

`team schedule tick`은 timezone-aware weekly/monthly slot을 확인해 idempotent한 `draft` Task를 만듭니다. 외부 cron/systemd timer가 tick만 호출하고, 실제 Runtime workflow 실행은 사람이 Task를 검토해 `ready`로 전환한 뒤 시작합니다.

중요 행동은 `team approval request`로 Human Inbox에 들어갑니다. 요청은 승인 대상 artifact의 SHA-256과 결합되며, 파일이 변경되면 기존 승인을 사용할 수 없습니다.

Workflow에는 `type: approval` step을 둘 수 있습니다. 해당 지점에서 run과 Task가 함께 멈추고, 승인 결정 후 완료되거나 같은 run의 다음 step부터 재개됩니다. `feature-delivery`는 release checklist에 결합된 마지막 승인 step을 포함합니다.

Engineering 변경은 `.agent-team/worktrees/<task-id>`의 전용 branch에서 수행합니다. Harness는 worktree와 diff evidence를 만들지만 merge, production 배포, worktree 삭제는 자동 실행하지 않습니다.

`feature-delivery`의 Engineering은 계획·구현·검토 세션으로 분리됩니다. 구현 세션만 managed worktree 쓰기가 가능하고, 완료 뒤 실제 변경 파일을 Task의 `writable_paths`와 대조합니다. 계획과 검토 세션은 읽기 전용이며 세 세션의 결과가 각각 검증된 Handoff로 남습니다.

전체 설계와 단계별 구현 계획은 [agent-team-harness-plan.md](./agent-team-harness-plan.md)를 참고합니다.

- [시작 안내](./docs/getting-started.md)
- [운영 안내](./docs/operations.md)
- [복구 안내](./docs/recovery.md)
- [Knowledge 운영](./docs/knowledge.md)
- [구현 현황과 남은 단계](./docs/implementation-status.md)
