# Getting Started

## 요구 사항

- Node.js 22 이상
- Git
- Claude Code, Codex, Gemini CLI 중 하나 이상

## 설치

```bash
npm install
npm run check
npm test
npm run build
npm link
```

## 프로젝트 초기화

제품 저장소의 루트에서 실행한다.

```bash
team doctor
team init --runtime codex
team bootstrap status
```

`team init`은 다음을 수행한다.

- 선택 Runtime의 설치 여부 확인
- `.agent-team/config.json`과 event 디렉터리 생성
- 기존 파일을 덮어쓰지 않고 `company/`, `knowledge/`, `work/` 템플릿 생성

먼저 `company/profile.yaml`의 `undecided` 값을 실제 사실로 바꾼다. 모르는 값은 추측하지 않고 그대로 남긴다.

## 기본 점검

```bash
team agents
team ask product-growth "현재 제품 가설에서 확인할 질문을 정리해줘" --dry-run
team ask product-growth "현재 제품 가설에서 확인할 질문을 정리해줘"
team workflow inspect idea-validation
team inbox
```

현재 `team ask`는 읽기 전용이다. 정상 실행 결과는 Runtime별 stream을 그대로 노출하지 않고 공통 Agent Result JSON으로 반환한다. schema에 맞지 않는 응답은 실패한다. Agent가 생성한 문서 변경은 scoped writer와 workflow를 통해 연결해야 한다.
