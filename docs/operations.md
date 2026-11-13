# Operations

## 주간 운영

`weekly-operations` workflow는 Product, Engineering, Finance, Risk의 변경을 Founder Office가 한 페이지로 통합하도록 정의한다. 예약 실행은 아직 구현 대상이지만 CLI에서 선택한 Runtime으로 workflow를 직접 실행할 수 있다.

```bash
team task transition <task-id> ready
team workflow run weekly-operations --task <task-id>
team workflow list --task <task-id>
```

각 step의 상태와 시도 횟수, Handoff ID는 `.agent-team/state.db`에 기록된다. 실패하거나 프로세스가 중단된 경우 run을 조회하고 재개한다.

```bash
team workflow show <run-id>
team workflow resume <run-id>
```

재개 시 `completed`와 `skipped` step은 다시 실행하지 않는다. 시작 당시 workflow SHA-256과 현재 YAML 정의가 다르면 재개를 거부하므로, 정의를 되돌리거나 새 Task/run을 만든다.

## Task와 Handoff

```bash
team task create --owner product-growth --objective "고객 문제 검증" --why "구현 전 위험한 가정 확인"
team task transition <task-id> ready
team handoff list <task-id>
```

Task와 Handoff는 `.agent-team/state.db`에 저장된다. Agent 사이에는 전체 대화가 아니라 schema를 통과한 Handoff만 전달한다.

## 승인

Workflow YAML은 `type: approval` step을 지원한다. `action`, 검토할 `artifact`, 선행 step을 선언하면 실행기가 artifact SHA-256에 결합된 Human Inbox 요청을 만들고 run을 `waiting_approval`에서 멈춘다.

```yaml
- id: release-approval
  type: approval
  action: release
  artifact: company/release-checklist.md
  requires: [scope-review]
  when: always
```

```bash
team inbox
team approval decide <approval-id> approve --reason "테스트와 rollback 증거 확인"
team workflow resume <run-id> # 승인 뒤 후속 step이 있을 때
```

승인 시 artifact가 요청 이후 바뀌었다면 결정을 거부한다. 마지막 step의 승인은 Task와 run을 완료하고, 중간 승인은 Task와 run을 재개 가능 상태로 전환한다. `request_changes`는 새 artifact hash로 승인 요청을 다시 만들게 하며 `reject`는 run을 실패 처리한다. Workflow 밖의 단독 승인은 기존 `team approval request --task ...` 명령으로 만들 수 있다.

승인 후 실제 외부 action을 실행하는 구성요소도 승인된 hash와 현재 artifact hash를 다시 비교해야 한다. 현재 Harness는 승인 상태를 기록하지만 production 배포를 실행하지 않는다.

## Engineering worktree

```bash
team worktree create <task-id>
team worktree inspect <task-id> --base-commit <sha>
```

merge와 worktree 삭제는 자동화하지 않았다. diff evidence를 검토하고 별도로 승인한다.
