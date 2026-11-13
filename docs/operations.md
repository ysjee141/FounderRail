# Operations

## 주간 운영

`weekly-operations` workflow는 Product, Engineering, Finance, Risk의 변경을 Founder Office가 한 페이지로 통합하도록 정의한다. 현재 CLI는 workflow 검사까지 제공하며, 실 Runtime을 이용한 `team weekly` 실행 명령은 아직 구현 대상이다.

## Task와 Handoff

```bash
team task create --owner product-growth --objective "고객 문제 검증" --why "구현 전 위험한 가정 확인"
team task transition <task-id> ready
team handoff list <task-id>
```

Task와 Handoff는 `.agent-team/state.db`에 저장된다. Agent 사이에는 전체 대화가 아니라 schema를 통과한 Handoff만 전달한다.

## 승인

```bash
team approval request --task <task-id> --action release --artifact work/releases/<file>
team inbox
team approval decide <approval-id> approve --reason "테스트와 rollback 증거 확인"
```

승인 후 실제 외부 action을 실행하는 구성요소는 승인된 hash와 현재 artifact hash를 다시 비교해야 한다. 현재 Harness는 승인 상태를 기록하지만 production 배포를 실행하지 않는다.

## Engineering worktree

```bash
team worktree create <task-id>
team worktree inspect <task-id> --base-commit <sha>
```

merge와 worktree 삭제는 자동화하지 않았다. diff evidence를 검토하고 별도로 승인한다.
