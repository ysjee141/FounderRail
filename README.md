# Solo Founder Agent Team

Claude Code, Codex 또는 Gemini CLI 중 하나를 선택해 동일한 1인 창업 Agent-Team을 실행하는 로컬 Harness입니다.

현재 구현 범위는 Runtime foundation입니다.

```bash
npm install
npm run build
npm link

team doctor
team init --runtime codex
team agents
team ask finance-ops "이번 달 runway 계산에 필요한 자료를 정리해줘" --dry-run
team run --prompt "현재 저장소의 상태를 한 문단으로 요약해줘"
```

Runtime 실행 이벤트는 `.agent-team/events/<run-id>.jsonl`에 저장됩니다. 기본 실행 모드는 `read-only`이며, 명시적으로 `--mode workspace-write`를 전달해야 파일을 변경할 수 있습니다.

전체 설계와 단계별 구현 계획은 [agent-team-harness-plan.md](./agent-team-harness-plan.md)를 참고합니다.
