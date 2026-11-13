# Recovery

## 보존 대상

- Git 저장소와 모든 추적 문서
- `.agent-team/state.db`
- `.agent-team/events/*.jsonl`
- `company/`, `knowledge/`, `work/`

`.agent-team/`은 기본적으로 Git에서 제외되므로 별도의 암호화된 backup이 필요하다. credential과 원본 결제·개인정보 자료는 이 디렉터리에 넣지 않는다.

## 복구 순서

1. 저장소를 검증된 commit으로 복구한다.
2. 동일 Node.js major와 의존성을 설치한다.
3. `state.db`와 JSONL event를 원래 경로에 복원한다.
4. `npm run check && npm test && npm run build`를 실행한다.
5. `team doctor`, `team runtime show`, `team bootstrap status`, `team inbox`를 확인한다.
6. `git worktree list`로 남은 Engineering worktree와 branch를 대조한다.

SQLite backup은 실행 중인 DB 파일을 단순 복사하지 말고 SQLite backup 방식이나 중지된 상태의 일관된 snapshot을 사용한다. 복원본은 별도 디렉터리에서 먼저 검사한다.

## Runtime 중단

Runtime timeout은 exit code `124`, 사용자의 AbortSignal 취소는 `130`으로 기록된다. POSIX에서는 CLI를 별도 process group으로 실행하고 TERM 후 KILL을 보내므로 CLI가 시작한 child command도 함께 종료한다. 실패 뒤 다음을 확인한다.

1. `.agent-team/events/<run-id>.jsonl`의 `run.failed`와 `termination`
2. `team workflow show <run-id>`의 현재 step
3. `ps`와 프로젝트별 도구로 남은 외부 프로세스·lock 확인
4. Engineering worktree의 `git status`와 허용 범위 밖 변경 확인
5. 원인이 제거된 뒤 `team workflow resume <run-id>`

Harness가 시작하지 않은 daemon, container, 원격 CI job은 process-group 종료 대상이 아니므로 별도 운영 절차로 정리한다.
