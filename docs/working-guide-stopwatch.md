# Agent-Team 운영 실습: 스톱워치 앱

이 문서는 1인 개발자가 Codex CLI와 `team` Harness로 작은 스톱워치 앱의 아이디어를 정리하고, 검증 workflow를 거친 뒤 기능을 구현·검토하는 과정을 따라 해보는 실습 안내서다.

예제 앱은 브라우저에서 동작하는 단순 스톱워치다. 로그인, 결제, 서버 저장, 분석 도구, 외부 배포는 이번 범위에 넣지 않는다. 실제 프로젝트가 다르면 예제의 사업 정보와 요구사항을 실제 사실로 바꿔 사용한다.

## 먼저 이해할 운영 방식

이 실습에서는 창업자가 Codex 대화형 세션으로 생각을 정리하고 문서를 편집하며, Harness Runtime도 Codex로 설정한다. 두 설정은 별개라 Harness Runtime은 Claude Code나 Gemini CLI로 선택해도 된다. `team workflow run`은 대화 중인 세션을 이어받지 않는다. 대신 선택된 CLI로 각 workflow 단계를 위한 별도 비대화형 세션을 열고, 프로젝트 문서·Task·앞 단계의 검증된 Handoff를 전달한다. Product나 Finance 같은 Agent는 각자 역할 지침과 권한을 뜻하며, 백그라운드에서 계속 대화하는 독립 프로세스는 아니다.

따라서 대화에서 나온 결정은 `company/`나 `work/` 문서에 남겨야 다음 Harness 실행에서도 사용된다.

```text
Codex 대화형 세션
  └─ 아이디어 논의, 문서 작성, 사람이 내린 결정 기록
       │
       ▼
team Task와 workflow
  └─ Product / Finance / Founder 또는 Engineering 역할 실행
       │
       ├─ 분석 결과: .agent-team/state.db의 Handoff
       └─ 코드 변경: Task 전용 worktree와 branch
                    │
                    ▼
              사람의 검토·승인·merge
```

각 실행 방법의 역할은 다음과 같다.

| 방법 | 언제 사용하나 | 현재 결과 |
|---|---|---|
| Codex 대화형 CLI | 아이디어 논의, 회사 문서·기능 명세 작성, 결과에 대한 대표 판단 기록 | 대화와 사람이 수정한 파일 |
| `team ask <agent>` | 한 Agent에게 빠른 의견이나 질문을 요청 | 공통 Agent Result JSON. 읽기 전용이며 문서를 수정하지 않음 |
| `team workflow run ...` | 여러 역할을 정해진 순서와 권한으로 실행 | 영속 run과 단계별 Handoff. Engineering 단계는 managed worktree에서 코드 변경 가능 |
| `team inbox` / `team approval decide` | workflow가 멈춘 승인 지점에서 사람이 판단 | Task/run 상태 갱신. 실제 배포나 merge는 수행하지 않음 |

## 0. 준비물과 앱 저장소

다음이 필요하다.

- Node.js 22 이상, Git
- 로그인되어 사용할 수 있는 Claude Code, Codex 또는 Gemini CLI 중 하나
- 기존 앱 저장소 또는 최소한의 실행 가능한 앱 골격

Harness는 실제 제품 코드의 초기 골격을 자동 생성하지 않는다. 앱이 아직 없다면 먼저 Codex 대화형 세션으로 작은 시작점을 만들고, 로컬에서 실행되는지 확인한 뒤 Git baseline을 만든다. 이 실습은 제품 저장소가 `/path/to/stopwatch`에 있고, 기존 프런트엔드 소스가 `src/`, 테스트가 `tests/`에 있는 상황을 가정한다.

Harness 저장소에서 `npm link`를 한 번 실행하면 로컬에서 `team` 명령을 사용할 수 있다.

```bash
cd /path/to/agent-team
npm install
npm run build
npm link
```

제품 저장소의 코드와 설정이 Git에 들어가 있고, 작업 시작점이 commit으로 저장되어 있는지 확인한다.

```bash
cd /path/to/stopwatch
git status --short
git log -1 --oneline
```

처음 만드는 저장소라면 Git을 초기화하고 현재 앱 골격을 먼저 commit한다. 이후 생성하는 Task 전용 worktree는 기본 checkout의 현재 commit에서 갈라지므로, 구현 Agent가 기준으로 삼아야 할 앱 구조는 commit에 포함되어 있어야 한다.

## 1. Harness를 스톱워치 저장소에 연결

제품 저장소 루트에서 초기화하고 사용할 Coding Agent CLI를 고른다.

```bash
cd /path/to/stopwatch
team doctor
team init --runtime codex
```

`team doctor`는 설치된 CLI를 확인한다. `team init`은 `.agent-team/config.json`에 Runtime을 기록하고 `company/`, `knowledge/`, `work/`의 시작 파일을 만든다. 이미 있는 파일은 덮어쓰지 않는다.

Harness는 Claude Code, Codex, Gemini CLI를 역할별로 섞어 실행하는 멀티 모델 라우터가 아니다. 제품 저장소마다 사용할 수 있는 Coding Agent CLI 하나를 Runtime으로 선택하고, Harness가 그 CLI로 Product·Finance·Engineering 등 역할별 세션을 실행한다. 설치된 다른 CLI로 바꾸려면 다음처럼 설정한다.

```bash
team runtime set codex  # 선택: claude 또는 gemini
```

셋 중 설치·인증된 Runtime을 고르면 같은 Agent 정의와 workflow를 쓸 수 있다. `team doctor`로 선택할 CLI가 실행 가능한지 먼저 확인한다.

기본 프로젝트 사실을 `company/profile.yaml`과 회사 문서에 채운다. 예를 들어 이 스톱워치는 다음과 같이 가정한다.

- 브라우저에서 실행하는 작은 앱
- 사용자가 시간을 재고 lap 기록을 확인함
- 로그인, 결제, 클라우드 저장, 분석 추적 없음
- 시작·일시정지·재개·초기화·lap이 첫 버전의 범위
- 시간은 화면에 표시하고 서버로 보내지 않음

Codex 세션을 하나 열고 다음처럼 문서 정리를 요청할 수 있다.

```text
이 저장소의 company/profile.yaml, company/product.md, company/customers.md를
읽고 스톱워치 앱의 현재 사실과 가정을 정리해줘.
로그인, 결제, 서버 저장, 사용자 분석은 이번 제품에 없다고 명시하고,
확정되지 않은 고객·가격·사업 정보는 사실처럼 쓰지 마.
파일을 수정한 뒤 바뀐 내용과 아직 결정이 필요한 질문을 요약해줘.
```

그 변경을 리뷰하고 저장소의 초기 운영 문서를 commit한다. 적어도 `company/profile.yaml`, `company/product.md`, `company/goals.md`, `company/customers.md`를 보존한다.

```bash
git add company
git commit -m "docs: record stopwatch product context"
```

`team bootstrap status`는 프로필에 남은 `undecided` 값을 보여준다.

```bash
team bootstrap status
```

초기 지식 자료는 Harness에 포함되어 있지 않다. 따라서 `team knowledge check`는 fresh·verified Knowledge Card가 없어서 실패할 수 있다. 이 상태는 아직 지식 카탈로그가 채워지지 않았다는 뜻이다. 현재 workflow 실행은 이 결과를 자동 차단 조건으로 사용하지 않으므로, 지식 검토가 필요한 의사결정은 공백을 인지하고 [Knowledge 운영 안내](./knowledge.md)에 따라 source와 Card를 추가한 뒤 진행한다.

## 2. 두 터미널로 일하기

실제로는 터미널을 두 개 열어두는 방식이 이해하기 쉽다.

**터미널 A: Codex 대화형 세션**

```bash
cd /path/to/stopwatch
codex
```

여기서 요구사항을 다듬고 `company/` 및 `work/specs/` 문서를 작성한다. 이 세션에서 나눈 말은 Harness workflow에 자동 전달되지 않는다.

**터미널 B: Harness 명령**

```bash
cd /path/to/stopwatch
team agents
team runtime show
```

여기서 Task 생성, workflow 실행, 상태·Handoff 조회, 승인 처리를 한다. workflow 실행은 `.agent-team/config.json`에 선택된 Runtime으로 별도의 비대화형 Coding Agent 세션을 연다. 사람이 단계마다 Codex CLI 세션을 직접 열 필요는 없다.

## 3. 구현 전에 아이디어 검증

첫 작업은 코드를 쓰기보다 문제와 가장 위험한 가정을 확인하는 것으로 잡는다.

```bash
team task create \
  --owner product-growth \
  --objective "스톱워치 첫 버전에서 풀 고객 문제와 가장 작은 검증 실험을 정리한다" \
  --why "사용자가 원하는 기능을 확인하기 전에 구현 범위를 늘리지 않기 위해서다"
```

명령은 생성된 Task JSON을 출력한다. 그 안의 `id`를 복사해 다음 명령의 `TASK-ID`에 넣는다.

```bash
team task transition TASK-ID ready
team workflow inspect idea-validation
team workflow run idea-validation --task TASK-ID
```

`idea-validation`은 Product → Finance → Founder 순서로 실행된다. 다음 단계에는 전체 대화가 아니라 앞선 Agent가 남긴 검증된 Handoff가 전달된다. 실행 결과에는 `runId`, 각 step의 상태와 시도 횟수가 나온다.

```bash
team workflow show RUN-ID
team handoff list TASK-ID
```

각 Handoff에는 요약, evidence, 결정, 가정, 위험과 다음 Agent가 들어 있다. Workflow 결과는 기본적으로 이 DB 기록이다. Product·Finance가 `company/product.md` 같은 문서를 자동 작성하는 기능은 아직 없으므로, 채택할 분석은 Codex 대화형 세션에서 검토해 결정 문서와 제품 문서에 반영한다.

검토가 끝난 Task는 완료로 표시한다.

```bash
team task transition TASK-ID completed
```

workflow가 성공적으로 끝나면 Task는 `in_review`가 된다. Handoff와 창업자 결정 기록을 확인한 다음 직접 `completed`로 마감한다.

Agent가 근거 부족으로 `blocked` 또는 `needs_input`을 반환할 수도 있다. 그때는 빠진 정보나 가정을 회사 문서에 추가하고 같은 run을 재개한다.

```bash
team task show TASK-ID
team workflow resume RUN-ID
```

예를 들어 Agent가 “학생과 러너에게 유용할 것”이라고 제안해도, 이를 고객 수요가 입증된 사실로 받아들이지 않는다. Handoff의 `evidence`에 실제 인터뷰나 관찰 자료가 있는지 확인하고, 없으면 다음처럼 `company/experiments/`에 창업자 판단을 남긴다.

```markdown
# 스톱워치 문제 검증 — YYYY-MM-DD

## 현재 근거
- 실제 사용자 인터뷰: 0건
- 관찰된 사용 행동: 없음

## 가설
- 운동 중 경과 시간과 lap을 빠르게 기록하려는 사람이 있다.
- 설치나 계정 없이 브라우저에서 바로 쓰는 방식이 이들에게 충분하다.

## 판단
- 고객 수요가 확인됐다고 보지 않는다.
- 1주 동안 잠재 사용자 5명에게 현재 기록 방법과 불편을 묻는다.
- 인터뷰에서 반복되는 구체적 문제를 확인한 뒤 MVP 구현 여부를 다시 결정한다.
```

이 판단을 `company/customers.md`와 `company/experiments/`에 반영하고 commit한다. 5명 인터뷰는 짧은 탐색 실험이지 시장 수요를 증명하는 표본은 아니다. 실험 결과가 부정적이면 구현 Task를 만들지 않고 가설을 수정하거나 중단한다. 긍정적 결과와 범위가 정리된 뒤에만 명세 단계로 간다.

이미 `completed`나 `skipped`인 단계는 재실행되지 않는다. 실행 시작 후 workflow YAML을 바꿨다면 digest가 달라져 재개가 거부되므로 새 Task/run을 만든다.

## 4. 스톱워치 첫 버전 명세

아이디어 검토를 마치고 직접 만들기로 결정했다면, Codex 대화형 세션으로 구현 명세를 작성한다. Engineering Agent는 `work/specs/**`를 읽을 수 있다.

예를 들어 `work/specs/stopwatch-v1.md`에 다음처럼 적는다.

```markdown
# Stopwatch v1

## 목적
브라우저에서 별도 계정 없이 경과 시간을 재고 lap 구간을 확인한다.

## 범위
- 시작
- 일시정지와 재개
- 초기화
- lap 기록과 목록 표시
- 경과 시간 표시: 분, 초, 1/100초
- 키보드로 주요 동작 사용 가능

## 제외
- 로그인·계정
- 서버·클라우드 저장
- 결제·구독
- 외부 분석·광고
- 여러 기기 간 동기화

## 수용 조건
- 시작 후 시간이 증가한다.
- 일시정지 중 값이 증가하지 않는다.
- 재개하면 기존 시간에서 이어진다.
- 초기화하면 시간과 lap 목록이 모두 비워진다.
- lap을 여러 번 기록하면 최신 lap이 위에 보인다.
- 일시정지·재개를 반복해도 표시값이 시스템 시각의 초 단위 누적 오차에 끌려가지 않는다.
- 주요 버튼을 키보드로 실행할 수 있다.

## 검사
- 기존 프로젝트 테스트 명령을 실행한다.
- 시작·일시정지·재개·초기화·lap의 로직 테스트를 추가한다.
- 수동 브라우저 확인 항목을 결과에 기록한다.

## 구현 경계
- 기존 프레임워크와 구조를 유지한다.
- 지정된 Task 경로 안에서만 수정한다.
- 새 의존성, 분석 SDK, 서버 연동은 추가하지 않는다.
```

명세 안의 시간 동작은 요구사항의 예시다. 실제 제품 의도와 기술 결정에 맞게 사람이 확인하고 수정한 뒤 저장한다. 첫 코딩 Task에서는 서버나 결제 같은 제외 범위를 분명히 두고, 명세 파일을 Git에 commit한다.

## 5. Engineering workflow로 구현

Task의 `objective`에 명세 경로를 넣고, 쓸 수 있는 경로를 좁혀 만든다.

```bash
team task create \
  --owner engineering \
  --objective "work/specs/stopwatch-v1.md 명세에 맞춰 첫 버전을 구현하고 검토한다" \
  --why "합의한 수용 조건으로 동작하는 작은 버전을 검증하기 위해서다" \
  --write "src/**" \
  --write "tests/**" \
  --forbid production.deploy \
  --forbid external.publish
```

출력된 Task ID를 사용해 실행한다.

```bash
team task transition TASK-ID ready
team workflow inspect feature-delivery
team workflow run feature-delivery --task TASK-ID
```

`feature-delivery`는 Product 요구사항 검토 Handoff, Engineering 계획, Engineering 구현, Engineering 검토 순으로 동작한다. Product Agent는 명세 문서를 수정하지 않는다. 구현 단계만 Task 전용 managed worktree에서 쓰기 권한을 갖는다. 코드 변경은 `agent-team/<task-id 소문자>` branch에 남고 메인 checkout에는 직접 적용되지 않는다.

중요한 운영 조건이 있다. Task를 `ready`로 바꾼 뒤 이 workflow를 실행하면 Product 검토, 계획, 구현, 검토 단계가 이어서 돈다. 현재 CLI에는 Product 결과나 계획을 사람이 승인한 후 다음 단계로 가는 중간 정지점이 없다. 그러므로 확정 명세는 workflow 실행 전에 사람이 작성해 commit한다. 구현 계획을 사전 승인해야 하는 크거나 위험한 변경은 이 workflow에 바로 넣지 말고 계획 검토와 구현을 별도 Task로 나눈다.

## 6. 결과, diff와 승인 검토

실행이 끝나면 상태와 Handoff를 확인한다.

```bash
team workflow list --task TASK-ID
team workflow show RUN-ID
team handoff list TASK-ID
team task show TASK-ID
```

코드 변경은 Task별 worktree에서 확인한다. `TASK-ID`의 대소문자를 소문자로 바꾼 디렉터리를 사용한다.

```bash
git -C .agent-team/worktrees/task-id status --short
git -C .agent-team/worktrees/task-id diff --check
git -C .agent-team/worktrees/task-id diff BASE-COMMIT
git -C .agent-team/worktrees/task-id ls-files --others --exclude-standard
```

`BASE-COMMIT`은 `.agent-team/engineering-worktrees/task-id.json`의 `baseCommit` 값이다. 마지막 명령은 아직 Git에 추가되지 않은 파일을 보여준다. 이 파일은 `git diff`에 나오지 않으므로 각각 내용을 직접 연다. Handoff에는 branch, HEAD, 바뀐 파일과 `git diff --check` evidence가 추가된다. 명세의 테스트와 수용 조건을 직접 대조하고, 프로젝트의 테스트·브라우저 실행도 확인한다.

마지막 `release-approval` step에서 workflow가 멈추면 inbox를 확인한다.

```bash
team inbox
team approval decide APPROVAL-ID approve --reason "스톱워치 명세, diff와 테스트 결과를 확인했다"
```

승인 요청은 현재 `company/release-checklist.md`의 hash에 연결된다. 따라서 이 승인은 Harness의 Task/run 상태를 끝내는 절차이며 코드 diff 자체에 대한 승인이거나 자동 merge 절차가 아니다. 위에서 실제 worktree diff와 테스트를 확인한 뒤 결정한다. 승인 후에도 branch는 남아 있다. 먼저 task worktree의 `git status`와 `git log`를 보고, 아직 commit되지 않은 검토된 변경만 사람이 commit한다.

```bash
# 작업 worktree에서 상태와 기존 commit 확인
git -C .agent-team/worktrees/task-id status --short
git -C .agent-team/worktrees/task-id log --oneline --decorate -5

# 변경이 아직 commit되지 않은 경우에만, 검토한 경로를 stage하고 commit
git -C .agent-team/worktrees/task-id add src tests
git -C .agent-team/worktrees/task-id commit -m "feat: implement stopwatch v1"

# 기본 checkout에서 팀의 통합 브랜치로 병합 (main은 실제 브랜치명으로 바꾼다)
git switch main
git status --short
git merge --no-ff agent-team/task-id
```

기본 checkout이 clean한지 확인한 뒤 merge한다. merge conflict가 나면 해결·검사한 뒤 commit하고, 앱을 다시 실행해 수용 조건을 확인한다.

Merge 뒤 앱을 다시 실행하고 테스트한다. Worktree와 branch 삭제도 자동으로 이뤄지지 않으므로, merge 결과가 확인된 뒤 프로젝트의 정리 절차를 따른다.

## 7. 실패·중단·수정 요청

- Runtime 또는 step이 실패했다면 `team workflow show RUN-ID`에서 마지막 상태와 오류를 확인한다.
- Agent가 `needs_input`을 반환했다면 질문에 답을 회사 문서나 명세에 기록하고 재개한다.
- 승인 단계에서 `request_changes`를 선택했다면 수정 후 `team workflow resume RUN-ID`로 다시 진행한다. 새 artifact hash에 대한 승인 요청이 생성된다.
- `reject`는 run을 실패시키고 Task를 취소한다. 코드 branch는 그대로 남으므로 사람이 내용을 확인한다.
- workflow 파일을 실행 중 수정하지 않는다. 실행 당시 정의와 현재 정의의 digest가 다르면 재개할 수 없다.

## 8. 주간 운영에도 같은 방식 적용

주간·월간 업무는 scheduler가 초안 Task만 만든다. 사람이 확인한 뒤 ready 상태로 전환하고 workflow를 실행한다.

```bash
team schedule list
team schedule tick
team task show TASK-ID
team task transition TASK-ID ready
team workflow run weekly-operations --task TASK-ID
```

`team schedule tick`은 Coding Agent를 부르지 않는다. 운영체제의 cron이나 systemd timer가 주기적으로 tick을 실행하도록 구성해야 한다.

## 9. 현재 사용 시 주의할 기능 경계

이 실습 흐름은 현재 구현된 CLI를 기준으로 한다.

1. **대화는 공유되지 않는다.** Codex TUI에서만 말한 결정은 workflow가 모른다. 회사 문서, spec 또는 Task objective에 기록한다.
2. **Task CLI는 간단한 입력만 받는다.** 현재 `task create`는 owner, objective, why, writable paths, forbidden actions를 받는다. 상세 수용 조건은 spec 파일에 둔다. `inputs`, `acceptance`, `checks`, `risk_flags`를 CLI에서 채우는 기능은 없다.
3. **Risk 분류가 Task에 자동 연결되지 않는다.** `team risk classify`는 분류 결과를 출력하지만 Task에 저장하지 않는다. 그래서 CLI에서 만든 Task의 `feature-delivery`에서는 조건부 `risk-review`가 건너뛰어질 수 있다. 인증, 결제, 개인정보 같은 변경은 현재 자동 risk step이 실행될 것이라고 가정하지 말고 별도로 Risk & Quality 검토를 요청하고 확인한다.
4. **Knowledge 기본 자료는 비어 있다.** `team init`은 source snapshot이나 검증된 전문 Card를 가져오지 않는다. Knowledge check 결과의 공백을 실제 검토로 메우고, 필요한 Card를 검증해 추가한다.
5. **문서 산출물은 자동 저장되지 않는다.** 분석 Agent의 결과는 Handoff로 저장한다. 사람이 채택한 내용을 Codex 대화형 세션에서 `company/` 또는 `work/` 문서로 반영한다.
6. **승인은 merge·배포가 아니다.** 사람이 diff와 테스트를 검토하고, 별도로 코드 통합과 배포를 실행한다.

이 경계를 이해하고 사용하면 Codex는 아이디어를 다듬고 사실을 문서화하는 대화 상대가 되고, Harness는 그 문서와 Task를 입력으로 받아 반복 가능한 역할 workflow를 실행하고 기록하는 운영 도구가 된다.
