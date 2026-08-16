# 전역 검색 — 설계

날짜: 2026-08-12 · 관련: ADR-013/015(iOS 메모리), ADR-014(도메인), ADR-020(사진 2장)

## 문제

책이 쌓이면서 찾기가 어려워졌다. 책장 목록은 `listBooks()` = `getAll("books")`라 **uuid 순, 사실상 무작위**이고(홈만 `recentBooks`로 최근 활동순), 무엇보다 "그 문장 어떤 책이었지"를 풀 방법이 앱에 없다. 캡처는 쌓이는데 다시 꺼내 볼 길이 Export밖에 없는 셈이다.

## 목표

홈에서 시작하는 **전역 검색** — 책(제목·저자)과 캡처 본문(담은 글·내 생각·레거시 why·ocr)을 한 번에 찾고, 결과를 **책별로 묶어** 보여준다.

비목표: 정규식·불리언 연산자, 검색 결과 정렬 옵션, 태그/기간 필터, 책장 순서 개편(별건).

## 핵심 제약 — 텍스트를 찾겠다고 사진을 메모리에 올리지 않는다

캡처의 `passage`/`memo`는 이미지와 **같은 레코드**에 있다. `allCaptures()`는 `getAll` + `fromStored`라 **모든 이미지를 ArrayBuffer로 읽고 Blob으로 되살린다**. 텍스트 검색에 이걸 쓰면 ADR-013/015 계열로 iOS에서 그대로 터진다. `countCaptures`가 "레코드 로드 없이" 세는 이유가 정확히 그것이다(`db.ts`의 기존 주석).

### 결정: 커서로 한 건씩 훑는다

`index("byCreated").openCursor()`로 한 레코드씩 열어 텍스트만 뽑고 즉시 `continue()`. 참조를 붙들지 않으면 **이미지 바이트는 한 번에 한 건만** 살아 있다. `pdf.ts`가 페이지 canvas를 누적하지 않고 즉시 해제하는 것과 같은 철학.

채택하지 않은 것:

- **텍스트 전용 보조 저장소(`captureText`)** — 이미지 바이트를 아예 안 건드려 가장 빠르지만, DB 버전 2 + 기존 캡처 전량 백필이 필요하고 쓰기 경로 4곳(`addCapture`/`updateCapture`/`deleteCapture`/`importBackup`)을 동기화해야 한다. 어긋나면 **검색 결과가 조용히 틀린다**. ADR-020에서 배열화를 거부한 이유(마이그레이션 인프라 없음, 회귀를 잡을 테스트 그물 없음)가 그대로 적용된다. 실제로 느린 게 확인되면 그때 가고, 그때도 커서 훑기가 백필 경로로 재사용된다.
- **인메모리 인덱스 캐시** — 첫 검색 지연은 커서와 같고 무효화 로직만 는다. YAGNI.

## DB 계층

`src/db/db.ts`에 함수 하나를 추가한다. 이 앱의 딥모듈 관례대로 좁은 인터페이스.

```ts
/** 검색 결과 1건 — 이미지 필드를 담지 않는 것이 이 타입의 계약이다. */
export interface CaptureHit {
  uuid: string;
  sessionId: string;
  createdAt: number;
  tag: Tag;
  snippet: string;   // 매치 주변 발췌(양옆 말줄임)
  field: "passage" | "memo" | "ocr";  // 어디서 맞았는지. why 매치는 "memo"로 보고한다(ADR-014)
}

export interface SearchResult {
  hits: CaptureHit[];
  truncated: boolean;  // limit에 걸려 중단됨
}

export async function searchCaptures(q: string, limit = 200): Promise<SearchResult>;
```

- 커서로 `byCreated` 역순 순회(최신 우선). 매치가 `limit`에 닿으면 **조기 종료**하고 `truncated: true`.
- 대상 필드: `passage`, `memo`, `why`(레거시 — ADR-014대로 note로 합쳐 취급). `page`·`tag`는 제외.
  - **`ocr`은 검색하지 않는다.** 타입에는 있지만 저장소 전체에서 `ocr: null` 외의 쓰기가 **0건**이다(2026-08-12 확인). 죽은 필드를 검색 대상으로 적으면 테스트로 덮을 것도 없고 읽는 사람을 오해시킨다. 나중에 실제로 채워지면 그때 추가한다.
- 매칭: 양쪽 `trim` + `toLowerCase()` 부분일치. 한글은 그대로 substring(자모 분해·초성 검색은 범위 밖).
- **스니펫:** 매치 위치 기준 앞 20자 / 뒤 60자를 잘라 양옆에 `…`. 필드 전체가 그보다 짧으면 그대로.
- **커서 루프 안에서 레코드를 배열에 담지 않는다.** 뽑은 텍스트로 `CaptureHit`만 만들고 원본 참조는 버린다. `fromStored`를 호출하지 않는다(Blob 생성 회피).
- **주기적 양보:** 100건마다 `await new Promise(r => setTimeout(r, 0))`. 커서는 레코드마다 이미지 ArrayBuffer를 잠깐씩 디시리얼라이즈하는데, 쉬지 않고 돌면 GC가 따라오기 전에 수백 개가 쌓일 수 있다. `pdf.ts`가 페이지마다 이벤트 루프에 양보하는 것과 같은 이유다. 이건 "열린 위험"이 아니라 **설계에 넣는 완화책**이다.

책 검색은 별도 함수가 필요 없다 — `listBooks()`를 화면에서 필터하면 된다. `Book.cover`는 ArrayBuffer라 `getAll("books")`가 표지 바이트를 함께 읽지만, **홈이 이미 매 진입마다 그렇게 하고 있고**(`recentBooks` → `listBooks`) 책 수는 캡처 수보다 한두 자릿수 적다. 즉 검색이 새로 만드는 부담이 아니다.

## 화면

### 진입 — 홈

`home.ts`의 `<h1>내 책</h1>` 아래에 검색 입력 한 줄. 2글자 이상 입력 시 **200ms 디바운스** 후 `nav({name:"search", q})`. 홈은 캡처 루프가 아니므로 3초 예산과 무관하다.

**한글 조합 중 검색하지 않는다.** iOS에서 한글을 치면 조합 중에도 `input`이 매 자모마다 발화해 "ㄱ→가→간→갇…"으로 헛검색이 돈다. `compositionstart`/`compositionend`로 조합 중에는 디바운스 타이머를 걸지 않는다(200ms 디바운스만으로는 조합이 느린 입력에서 새어 나간다). 검색 화면 안의 입력도 동일.

### 새 화면 `src/screens/search.ts`

`mountSearch(root, nav, initialQ): () => void` — 기존 화면 패턴(cleanup 반환) 그대로. `app.ts`의 `Route`에 `{ name: "search"; q: string }` 추가.

**뒤로가기가 검색어를 잃지 않아야 한다.** 지금 detail 라우트의 `from`은 `{ scope: Scope; id: string }`뿐이고 `Scope = "session" | "book"`이라, 검색 결과에서 캡처를 열면 뒤로가기가 리뷰 화면으로 간다 — 검색어가 날아간다. 여러 결과를 훑어보는 게 검색의 본질이므로 이건 못 넘긴다. `from`을 넓힌다:

```ts
| { name: "detail"; captureId: string; from: { scope: Scope; id: string } | { scope: "search"; q: string } }
```

`Scope` 자체는 건드리지 않는다 — `review.ts`가 `scope`로 `capturesForSession`/`capturesForBook`을 가르므로 거기에 `"search"`를 섞으면 깨진다. `detail.ts`의 `back`만 분기하면 된다.

**objectURL 수명:** 결과의 책 헤더에 표지가 나오므로 `home.ts`/`books.ts`와 같이 만든 URL을 모아 재렌더·cleanup에서 revoke한다. 검색은 타이핑마다 재렌더되므로 여기서 새는 게 다른 화면보다 아프다.

상단 검색 입력(자동 포커스·현재 질의 유지) + 결과. 입력이 바뀌면 같은 디바운스로 재검색하되 화면 전환은 하지 않는다.

**결과 구조 — 책별 묶음:**

```
『사피엔스』  · 매치 3           ← 탭: review(scope=book)
  [캡처 카드] [캡처 카드] [캡처 카드]   ← 탭: detail(from = book review)
『총 균 쇠』 · 제목 일치
```

- 캡처 히트를 `sessionId → bookId`로 접어 책별로 모은다. 세션→책 매핑은 `sessionsForBook`의 역방향이 필요하므로 `allSessions()` 한 번(세션 레코드는 텍스트뿐이라 가볍다).
- **책 제목·저자만 매치되고 캡처 매치가 없는 책도 헤더로 노출**한다("제목 일치" 표시).
- 책 정렬은 매치 수 내림차순, 동수면 최근 활동순. 활동 시각은 이미 읽어 둔 `allSessions()`에서 `max(started, lastCaptureAt)`로 계산한다 — `recentBooks()`를 부르지 않는다(그건 책마다 `countCaptures`를 돌아 검색 경로엔 과하다).
- 캡처 카드는 `review.ts`의 카드와 같은 시각 언어(태그 pill + 발췌 + 시각)를 쓰되, 검색 결과는 **스니펫과 매치 강조**가 필요해 `search.ts`에 별도로 둔다. 강조는 `escapeHtml` 이후에 넣어 XSS를 만들지 않는다.

**빈 상태·한계:**
- 결과 없음 → "찾는 내용이 없어요" (사과하지 않고 다음 행동 안내 — 디자인 언어)
- `truncated`면 목록 끝에 "결과가 많아 200개까지만 보여줘요"를 **눈에 보이게**. 조용한 절단 금지.

## 문서

- **ADR-022 — 전역 검색: 커서 훑기(이미지 비적재)**. `CaptureHit`가 이미지 필드를 담지 않는다는 계약, 보조 저장소를 미룬 이유, 상한 표시 원칙.
- `docs/glossary.md`에 "검색" 항목, `CLAUDE.md` 아키텍처 절에 `search.ts`와 `searchCaptures` 한 줄.

## 검증

`scripts/search-smoke.cjs` + `npm run test:search` (기존 스모크 패턴 — dev 서버 spawn + chromium):

1. **사진 있는 캡처가 섞여 있어도** 텍스트 검색이 정상 동작한다.
2. **`searchCaptures` 반환 객체에 `image`/`image2` 키가 없다** — 이 설계의 핵심 계약에 대한 회귀 가드.
3. 책 제목 매치와 캡처 매치가 한 화면에 함께 묶인다.
4. `limit`을 낮춰 `truncated: true`가 되고 화면에 그 사실이 표시된다.
5. 결과 없음 문구가 뜬다.
6. **검색 → 캡처 상세 → 뒤로가기가 검색 결과로 돌아오고 검색어가 남아 있다.**
7. 검색을 반복해도 objectURL이 누수되지 않는다(생성 수 = revoke 수).

추가로 `npm run build` / 기존 `test:pdf` / `test:camera` 회귀 확인.

**실기기(iOS)** — 캡처가 수백 개 쌓인 상태에서 검색이 체감상 멈추지 않는지, 메모리로 죽지 않는지. 헤드리스로는 잡히지 않는다(ADR-013).

## 열린 위험

- **O(N) 훑기.** 캡처 수백 개까지는 문제없을 것으로 보지만 실기기 수치가 없다. 느리면 보조 저장소(위 §채택하지 않은 것)로 간다 — 그 전환은 `searchCaptures`의 시그니처를 바꾸지 않으므로 화면 코드는 그대로다. 이게 좁은 인터페이스로 감싸는 이유다.
- **커서 순회 중 이미지 디시리얼라이즈가 건별로 일어난다.** 100건마다 이벤트 루프에 양보해 완화하지만(위 §DB 계층), 3200px JPEG가 수백 개일 때 실제로 충분한지는 **실기기 수치가 없다**. 이 설계에서 유일하게 "해보기 전엔 모른다"에 남는 부분이다.
- **`why`는 레거시 읽기 전용이라 신규 캡처엔 없다.** 검색 대상에 넣는 건 옛 캡처를 위한 것이고, 시간이 지나면 죽은 코드가 된다. `ocr`처럼 되기 전에 주기적으로 재검토할 것.
