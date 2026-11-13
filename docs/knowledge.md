# Knowledge Operations

Agent 전문성은 검증된 최소 지식을 역할별로 공급하고, 적용 범위 밖에서는 멈추게 하는 방식으로 관리한다. 웹 페이지를 그대로 context에 넣거나 Runtime의 기억을 지식 저장소로 사용하지 않는다.

## 저장 흐름

```text
공식 원문·표준·벤더 문서
  → knowledge/sources/snapshots/ 원문 또는 허용된 검증 메모
  → knowledge/sources/manifest.yaml 메타데이터와 SHA-256
  → knowledge/cards/*.yaml 원자 주장·적용 조건·행동·escalation
  → freshness·hash·coverage gate
  → knowledge/compiled/*.md 역할별 reference
  → Agent prompt의 Approved company context
```

원문 이용 조건이 복제를 허용하지 않으면 전체 문서를 저장하지 않는다. 허용된 검증 메모와 공식 URL을 저장하고, `content_path`가 실제로 무엇인지 제목과 본문에 명확히 표시한다.

## Source 등록

`knowledge/sources/manifest.yaml`의 source에는 기관, 공식 URL, 종류, 모듈, 관할, snapshot 경로·hash, 수집일, 검증일과 다음 검토일을 기록한다. 법률·세무·플랫폼 정책처럼 변동성이 높은 자료는 짧은 `review_after`를 사용한다.

```bash
sha256sum knowledge/sources/snapshots/<file>
team knowledge check
```

`status: candidate`, hash 불일치, snapshot 경로 이탈, 지난 `review_after` 중 하나라도 있으면 해당 source를 참조하는 Card는 활성화되지 않는다.

## Knowledge Card

Card 하나에는 주장 하나를 둔다. 최소 필드는 다음과 같다.

- `claim`: 출처가 뒷받침하는 제한된 주장
- `action`: Agent가 실제 업무에서 수행할 검사
- `applies_when`, `does_not_apply_when`: 적용 조건과 반례
- `source_ids`: 검증된 source 연결
- `roles`: 주입할 Agent
- `risk`, `professional_review`: 위험과 외부 전문가 필요성
- `verified_at`, `review_after`, `status`

`team knowledge compile`은 fresh·verified Card만 Markdown reference로 생성한다. compile 결과 파일을 직접 편집하지 않는다.

## Qualification gate

```bash
team knowledge check
team knowledge compile
```

두 명령은 다음을 결정적으로 검사한다.

- source/card schema와 중복 ID
- snapshot SHA-256과 관리 디렉터리 이탈
- 검증 상태와 freshness
- Card의 모든 source 참조
- `knowledge/catalog.yaml` active module coverage

모든 active module에 최소 한 개의 fresh·verified Card가 있어야 `qualified: true`다. 미검증·오래된 Card는 compile 파일이 남아 있더라도 Agent context에 주입되지 않는다. 실제 주입은 매 실행 시 원본 manifest와 hash를 다시 검사한다.

## 한계와 승인

동일 Runtime의 verifier가 원문과 Card를 대조해도 변호사·세무사·회계사·보안 전문가의 판단을 대체하지 않는다. `professional_review: required` 또는 `conditional` Card는 결론을 자동 확정하는 권한이 아니라, 필요한 자료·질문·검사 항목을 빠뜨리지 않기 위한 기준선이다. 전문가 답변은 적용 범위와 날짜를 가진 새 source/Card 및 회귀 eval로 반영한다.
