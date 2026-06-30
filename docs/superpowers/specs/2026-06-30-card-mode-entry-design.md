# 카드에서 모드 선택 캡처 진입 설계 (spec)

날짜: 2026-06-30
관련: ADR-005(세션 생명주기), 캡처 모델·모드 개편(passage/입력 모드), design-language.md
검토: codebase-design + 충돌 감사(Go-with-adjustments) 반영.

## Context

캡처 0개인 닫힌 세션 카드를 탭하면 **빈 Review**(막다른 곳)로 간다. 사용자가 카드에서 **사진/입력 모드를 골라 바로 캡처**할 수 있어야 한다. 또한 진입 흐름이 세션 open/closed에 묶여 혼란스럽다.

## 결정 (검토 반영)

- **본문 탭(기존 유지, 퇴보 없음):** 열린 세션 카드 → 캡처(이어읽기), 닫힌 세션 카드 → Review. (현 `handleSessionTap` 그대로.)
- **모든 카드에 `📷 사진` / `✍️ 입력` 버튼 추가** → 그 모드로 캡처:
  - 세션 **열림** → 이어가기: `nav({name:"capture", sessionId, mode})`.
  - 세션 **닫힘** → 그 책으로 **새 세션 시작**(ADR-005 "책 다시 펴기") → `nav({name:"capture", sessionId:newId, mode})`.
- **빈 Review(캡처 0개)도 막다른 곳이 안 되게** 동일한 `📷/✍️` 시작 버튼을 빈 상태에 추가.

## 컴포넌트/변경

### 1. `src/db/db.ts` — 세션 시작 헬퍼 추출 (중복 제거)

`books.ts:121–133`의 `endAllOpenSessions + uuid + putSession` 시퀀스가 home에도 중복될 참 → **공용 헬퍼로 추출**(deletion test 실패 방지). mode는 라우팅 관심사라 제외.
```ts
export async function startNewSession(bookId: string, project?: string): Promise<string> {
  const now = Date.now();
  await endAllOpenSessions(now); // ADR-005 §종료3
  const session: Session = { uuid: uuid(), bookId, project, started: now, ended: null };
  await putSession(session);
  return session.uuid;
}
```
- `books.ts` renderProject 시작 핸들러도 이 헬퍼를 쓰도록 리팩터(동작 불변).

### 2. `src/screens/home.ts` — 카드 모드 버튼 + data-book

- `topCard`/`recentItem` 템플릿에 `data-book="${v.session.bookId}"` 추가(`SessionView.session.bookId` 이미 존재 — db 변경 불필요).
- 두 버튼 `📷 사진`/`✍️ 입력` 추가. **`recentItem`(좁은 행)** 은 버튼이 안 들어가니 **콘텐츠 아래 버튼 스트립** 한 줄(아이템 높이 증가 의도). topCard도 본문 아래 버튼 스트립.
- 핸들러: `captureInMode(sessionId, bookId, isOpen, mode)`:
  ```ts
  async function captureInMode(sessionId, bookId, isOpen, mode) {
    const id = isOpen ? sessionId : await startNewSession(bookId);
    nav({ name: "capture", sessionId: id, mode });
  }
  ```
- 본문 탭(`handleSessionTap`)은 그대로. 버튼은 `ev.stopPropagation()`로 본문 탭과 분리.

### 3. `src/screens/review.ts` — 빈 상태에 시작 버튼

- `emptyState()`(캡처 0개)에 `📷 사진`/`✍️ 입력` 버튼 추가. Review는 세션의 bookId를 알고 있음(로드 시 `session` 보관).
- 핸들러: 세션 열림이면 `nav capture(sessionId, mode)`, 닫힘이면 `startNewSession(bookId)` → capture. (home과 동일 로직 — 가능하면 같은 헬퍼 재사용.)
- 문구는 모드 무관(이미 "캡처 화면에서…"로 갱신됨). 버튼이 실제 행동을 제공.

### 4. `src/styles/app.css` — 카드/리뷰 버튼 스트립

- `.card-modes`(또는 재사용) 2-세그먼트: `📷 사진`/`✍️ 입력`, 탭타깃 ≥48px, 토스-클린(보조 톤). recentItem 아래 스트립 레이아웃 + 높이 보정.

## 디자인 언어 / 제약
- 토스-클린, 탭타깃 ≥48px, 마이크로카피 "사진"/"입력"(기존 모드 토글과 동일 문구). 버튼은 본문 탭과 시각·동작 분리.
- 알려진 부작용(검토): 닫힌 카드 버튼이 `endAllOpenSessions`로 **다른 책의 열린 세션을 조용히 종료**(ADR-005 §3, 기존 books 동작과 동일) — 신규 문제 아님, 토스트 없음(현행 유지).

## 영향 파일
`src/db/db.ts`(startNewSession), `src/screens/books.ts`(헬퍼 사용 리팩터), `src/screens/home.ts`(카드 버튼+data-book+핸들러), `src/screens/review.ts`(빈상태 버튼), `src/styles/app.css`.

## 검증 (Verification)
테스트 프레임워크 없음 → `npm run build`(tsc) + `npm run preview` 수동(+ iOS 실기기).
1. `npm run build` 무에러(startNewSession 시그니처, books 리팩터).
2. preview:
   - 열린 세션 카드 본문 탭 → 캡처(이어읽기) 유지. 닫힌 카드 본문 탭 → Review.
   - 카드의 📷 → 사진 캡처, ✍️ → 입력 모드 캡처. 닫힌 카드 버튼 → 새 세션 생성 후 그 모드 캡처.
   - 캡처 0개 세션의 빈 Review에 📷/✍️ 버튼이 있고 누르면 캡처로.
   - recentItem 버튼 스트립이 안 깨지고 ≥48px.
3. books 시작 흐름(헬퍼 리팩터 후)도 기존대로 동작.

## 미해결/주의
- recentItem 높이 증가가 목록 리듬에 주는 영향은 preview로 확인(필요 시 버튼 더 컴팩트).
- 여러 열린 세션이 동시 존재하는 엣지(기존 `openSession` 동작) — 신규 문제 아님.
