# Glossary — Capture PWA (Ubiquitous Language)

> 코드·UI·문서에서 같은 개념은 같은 단어로 부른다. `grill-with-docs`/domain-modeling 산출물.

## 핵심 도메인

- **Book** — 사용자가 읽는 책. 등록은 책당 1회. 필수: `title`. 선택: `author`, `isbn`, `cover`. (ADR-006)
- **Session (회독)** — 한 책의 N번째 읽기. 코드 식별자는 `Session` 유지. Book과 1:N. `started`, `ended`(nullable), `project`(목적, 선택). 회독 번호는 계산(`started` asc 1-based, `roundNumberOf`) + `roundNo` override. 자동 종료 없음 — `startNewSession`이 그 책의 열린 회독만 닫고 새로 시작; 캡처 진입·공유 수신은 `currentRoundFor`(get-or-create, 아무것도 닫지 않음). **회독 UI는 잠복 상태**(2026-07-02, ADR-016 개정) — 배지·"새 회독 시작"·회독 구분 등 노출 제거, 데이터 모델·db 헬퍼는 그대로(재도입 시 UI만 복원). UI 문구는 "기록"으로 중립화. (ADR-005 개정, ADR-016)
- **Capture** — 독서 중 붙잡은 하나의 생각. Session(회독)에 속함. 유효 조건: `(image 또는 passage 또는 note) + tag`. (ADR-004, ADR-014)
- **Project (목적)** — 회독(Session)에 붙는 선택적 목적 텍스트("지방교육 프로젝트"). "왜 이 책을 읽는가". Capture 화면 상단에 표시, 독서 시작 화면에서 입력. 코드 필드명은 `Session.project`. 회독 UI 잠복으로 Review의 ✎ 사후 편집은 제거됨(ADR-016 개정). (ADR-016)

## Capture의 구성요소

- **Image (사진)** — 선택. 책 페이지 등의 사진. 리사이즈+압축된 Blob로 저장, 원본 미보관. (ADR-001, ADR-003)
- **Passage (글/인용)** — 선택. 책에서 담고 싶은 글·인용. "저자의 문장". `image`와 함께 *책 내용*의 텍스트 입력 경로. `Capture.passage`. (ADR-014)
- **Note (노트/메모)** — 선택. 내 생각·주석. `Why`(저장 의도)를 흡수한 자유 텍스트. 코드 필드명은 `memo`. (ADR-014)
- **Memo (메모)** — `Note`의 코드 내부 필드명(`Capture.memo`). UI/문서에서는 `note`로 표기.
- **Tag (태그)** — 필수, **단일**. "AI에게 주는 대표 힌트"(감정 아님). 💡흥미 ⭐중요 🔗연결 ❓의문 🌱아이디어. (ADR-002)
- **Why** — @deprecated (ADR-014). 기존 `WHY_CHIPS` 기반 저장 의도 필드. 새 캡처에는 사용하지 않음. 레거시 DB 레코드 읽기 전용으로 보존(`Capture.why?`); 표시·Export 시 `note`로 합쳐 출력.

## 경로/모드

- **사진 경로 (빠른 경로)** — 카메라 항상 켜짐 → 찰칵 → **편집 시트 상승**(사진 확인·다시 찍기·태그·담은 글·생각·페이지) → 저장 → 시트 하강, 라이브 복귀. 사진이 있으면 **태그만 필수**. **3초 예산 적용**, 타이핑 없이도 완료 가능(태그+저장 2탭). (ADR-001, ADR-018)
- **메모 경로** — 사진 없이 텍스트로 캡처. 의도적 느린 경로, 3초 예산 미적용. (ADR-001)
- **Capture Loop Budget** — "타이핑 없이도 3초 안에 완료 *가능*". 회귀하면 머지 금지. (PRD 16, ADR-001 보강)

## 정리/내보내기

- **Review** — 세션/책의 캡처를 규칙 기반으로 분류(태그별·시간순). 의미 분석은 안 함 → 외부 AI에 위임. 결론은 "Export" 버튼. (ADR-007)
- **Export** — **2채널**: ① 프롬프트(prompt.md 텍스트)는 **클립보드로**(내보내기 탭 시 자동 복사, AI 채팅에 메시지로 붙여넣기) ② **PDF는 자료 전용**(요약 표지 1장 + 사진 페이지) — Web Share 1순위, 다운로드 폴백. 보조: 프롬프트 복사. (ADR-008, ADR-019)
- **prompt.md** — 자기완결형 내보내기 지시 텍스트. 버전된 고정 템플릿(`capture-prompt v4` — 다중 턴: 원문 전사 → "계속" → 분석). MVP는 1종. (ADR-008, ADR-009, ADR-019)
- **Export Status** — 캡처가 내보내졌는지 상태(데이터 모델 필드).

## 동기화

- **IndexedDB** — 기본 로컬 저장소. 서버·로그인 없음.
- **백업 Import/Export** — 기기 간 이동 수단. **단일 JSON** 파일(`backup.ts` — 이미지 Blob↔base64). UUID 기반 upsert 복원. (PRD 12)
