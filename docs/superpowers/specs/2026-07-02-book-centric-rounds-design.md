# 책 중심 전환 — 세션을 "회독"으로 잠복 + 책장 (spec)

날짜: 2026-07-02
관련: ADR-005(세션 생명주기 — 본 건으로 개정→ADR-016), ADR-014(캡처 모델), glossary
후속 별건: 책 표지 썸네일 외부 조회(ADR-006 개정 사안 — 소스 조사 후 별도 spec)

## Context

사용자 통찰: **관심 단위는 책**이지 "지금 8시간짜리 세션"이 아니다. 매번 세션이 자동 생성·종료되는 게 이상하고, 세션이 의미가 있다면 **1회독/2회독** 차원이다. 회독에는 **번호 + (나중에라도 달 수 있는) 제목/목적**이 있으면 좋겠다. 또한 책을 관리하는 **책장**이 있으면 좋겠다.

## 결정 (승인된 방향 A)

**세션 스키마는 그대로 두고 의미를 "회독"으로 재정의**(잠복). UI는 책 중심으로 전환. 마이그레이션 없음(Capture.sessionId 유지, 백업 호환).

### 1. 도메인 의미 (ADR-016, 스키마 불변)
- `Session` = **회독(reading round)**. **회독 번호는 저장하지 않고 계산**: 그 책의 세션들을 `started` 오름차순 정렬한 1-based 인덱스("1회독", "2회독"…).
- `session.project` = **회독 제목/목적**(선택). 기존 Review ✎ 편집 재사용 — **나중에라도 추가·수정 가능**(요구 반영).
- **생명주기 단순화:**
  - 8시간 자동 종료 **삭제**(main.ts `endStaleSessions` 호출 제거; db의 해당 함수는 미사용화—제거 가능).
  - "다른 책 시작 시 이전 세션 종료" **삭제** — `startNewSession`의 `endAllOpenSessions` 전역 종료를 **그 책의 열린 회독만 종료**로 변경(여러 책 병행 자연스러움).
  - 회독이 닫히는 유일한 경로 = **"새 회독 시작"**(그 책의 이전 회독을 닫고 새 회독 생성).
- **현재 회독** = 그 책의 세션 중 `ended == null`인 것(레거시로 여럿이면 최근 활동 것 — 정상 흐름에선 책마다 1개).
- **회독 번호 수정 가능(추가 요구):** `Session.roundNo?: number` 선택 필드(마이그레이션 불필요·백업 호환). **표시 = `roundNo ?? 계산값`**(레거시 부풀림 교정용). 새 회독 생성 시(새 회독 시작·자동 생성) `roundNo = 직전 회독 표시번호 + 1` 저장 → 교정이 이후 번호로 이어짐. 편집은 Review ✎에서 번호+제목 함께.
- **[핵심 헬퍼(검토 C3)] `currentRoundFor(bookId): Promise<string>`** — get-or-create: 열린 회독 있으면 그 uuid, 없으면 **아무것도 닫지 않고** 새 세션 생성 후 uuid. **모든 📷/✍️ 진입과 공유 수신이 이걸 사용.** `startNewSession`(그 책만 닫고 새로)은 **"새 회독 시작" 버튼 전용**.
- `startNewSession` 내부의 `endAllOpenSessions`(전역) → `endOpenRoundsForBook(bookId, now)`(그 책만)으로 교체(검토 C1·2). 전역 함수는 미사용화.

### 2. 홈 = 책 목록 (`home.ts`)
- "지금 읽는 책" 상단 카드 + "최근 세션" 목록 → **최근 캡처순 책 목록**으로 재구성(중복 세션 항목 소멸).
- 책 카드: 제목 + 현재 회독 표시(`N회독${project ? " · "+project : ""}`) + 누적 캡처 수 + 최근 활동.
- 본문 탭 → **책 Review**(`review(book, bookId)`) — `handleSessionTap` 세션 라우팅을 책 라우팅으로 재작업(검토 M5: 카드 data도 book 중심으로). 📷/✍️ 버튼 → `currentRoundFor(bookId)` → 캡처(사용자에겐 "이어짐").
- db 조회 `recentBooks(n): Promise<BookView[]>`(검토 C7):
  ```ts
  interface BookView {
    book: Book;
    currentRound: Session | null;  // ended==null인 세션(최근 활동 우선)
    roundNumber: number;           // currentRound의 1-based 순번(started asc 정렬 — IDB 순서 아님, JS sort 필수). 없으면 totalRounds.
    totalRounds: number;
    captureCount: number;          // 책 전체
    lastActivity: number;
  }
  ```
- CTA는 항상 "▶ 독서 시작"(open 조건부 "+ 다른 책으로 시작" 문구 소멸, 검토 M4) → 책장.
- **주의(검토 10):** 홈은 이 배치의 최대 단일 화면 재작업(데이터 소스 교체 수준 아님).

### 3. 책장 (`books.ts` 승격)
- 기존 books 화면(책 목록 + 등록 + ✎ + 🗑)을 **"책장"**으로: 타이틀 변경, 책 행에 캡처 수·회독 수 표시. 책 선택 시 **세션 시작 화면 없이 바로 캡처**(현재 회독; 없으면 생성). 모드 선택(📷/✍️)은 행 버튼 또는 선택 후 화면에서 — 기존 renderProject의 모드 토글을 "시작 화면"이 아니라 **가벼운 진입(모드+회독 제목 선택 입력)**으로 축소하거나, 책장 행에 📷/✍️ 직접 배치(홈 카드와 동일 패턴). **구현 단순화 우선: 책장 행에도 📷/✍️ + 행 탭=책 Review.**
- 새 책 등록 → 등록 직후 1회독 자동 생성 + 캡처 진입(현 흐름 유지, 세션 화면 문구만 회독으로).

### 4. Review (`review.ts`)
- **기본 스코프 = 책**. 홈/책장에서 책 탭 → `review(book, bookId)`.
- **[검토 C5] 책 스코프도 `currentRound` 로드**: `scope==="book"` 분기에서 `sessionsForBook(id)`의 열린 세션을 `currentRound`로 보관(현재 세션 스코프만 `session`을 로드해 book 스코프에선 ✎가 조용히 no-op — 반드시 수정). ✎(회독 제목 편집)·"새 회독 시작"은 `currentRound` 대상.
- 책 Review 상단: 현재 회독 배지("2회독 · 발췌 정리") + ✎ + **"새 회독 시작"**.
- **[검토 4·4b] 책 스코프에도 📷/✍️ 캡처 버튼 상시 노출**(`currentRoundFor(bookId)` → capture) — "새 회독 시작" 후엔 review 재렌더(배지 증가)되고 바로 옆 📷/✍️로 이어 캡처(막다른 곳 없음, 별도 네비 불필요).
- 세션 스코프 review = **"이번 회독"**(문구 교체, review.ts:46).
- **[검토 C8] 회독 구분 데이터**: `capturesWithRoundsForBook(bookId): Promise<{roundNumber:number; session:Session; captures:Capture[]}[]>` 헬퍼 추가(기존 capturesForBook 시그니처 불변) → 책 스코프 목록에 "— N회독 —" 라벨.
- "이 세션 삭제" → **"이 회독 삭제"**(deleteSession 재사용, confirm 문구 교체).

### 5. Export / 공유 수신 / 기타
- Export 스코프 문구: `export.ts:31` scopeLabel "이번 세션" → **"이번 회독"**; **[검토 M3] `export.ts:93` PDF 파일명의 "세션" → "회독"**; `prompt.ts:16` 주석도.
- **[검토 7] 공유 텍스트 수신(main.ts)**: `recentBooks(1)`로 최근 책 → **`currentRoundFor(bookId)`(자동 생성 포함)** → capture(input). **책이 하나도 없을 때만** books로. (홈 📷과 동일한 get-or-create 의미론.)
- review.ts 캡처 버튼(`session.ended==null ? uuid : startNewSession`)도 `currentRoundFor`로 교체(검토 C4).
- 캡처 화면 상단 책 제목 표시는 그대로.
- 문구 전면 교체: "세션" → "회독" — 홈/books(**books.ts:87 삭제 confirm "모든 세션·캡처"→"모든 회독·캡처"**, 검토 9)/review/export/**transfer.ts:63 복원 flash**(검토 M1)/빈 상태. glossary 갱신.

### 6. 문서
- **ADR-016** 추가(세션=회독 재정의, 생명주기 단순화, 홈=책, ADR-005 개정).
- `docs/glossary.md`: 세션 → 회독 정의 갱신.

## 영향 파일
`src/db/db.ts`(**currentRoundFor**·startNewSession 범위 축소(endOpenRoundsForBook)·endStaleSessions 제거·**recentBooks/BookView**·**capturesWithRoundsForBook**), `src/main.ts`(endStaleSessions 제거·공유 수신을 recentBooks+currentRoundFor로), `src/screens/home.ts`(**최대 재작업** — 책 목록·라우팅·카드), `src/screens/books.ts`(책장 승격·삭제 confirm 문구), `src/screens/review.ts`(book 스코프 currentRound 로드·배지·✎·새 회독·📷/✍️ 상시·회독 구분·문구), `src/screens/capture.ts`(문구 최소), `src/screens/export.ts`(scopeLabel·파일명)+`src/lib/prompt.ts`(주석), `src/screens/transfer.ts`(flash 문구), `docs/decisions.md`(ADR-016), `docs/glossary.md`.

## 마이그레이션/호환
- **없음.** 기존 세션 레코드 = 그대로 회독. 여러 닫힌 세션이 있는 책 = 이미 N회독처럼 보임(자동 종료로 쪼개진 기존 세션들이 회독 번호를 부풀릴 수 있음 — 수용: 과거 데이터는 참고용, 신규부터 깔끔).
- 백업/가져오기·PDF·프롬프트 파이프라인 구조 불변.

## 범위 밖 (후속)
- **책 표지 썸네일 외부 조회**(교보/카카오/알라딘/OpenLibrary — 클라이언트 전용·키·CORS 조사 필요, ADR-006 개정) → 별도 spec.
- 회독별 상세 통계/비교 뷰.

## 검증
`npm run build` + preview: 홈=책 목록(회독 배지), 책장 관리, 캡처가 현재 회독에 계속 붙는지(자동 종료 없음), 새 회독 시작 → 번호 증가, 회독 제목 사후 편집, Export 문구, 공유 수신(최근 책). `test:pdf` PASS. 실기기 최종.
