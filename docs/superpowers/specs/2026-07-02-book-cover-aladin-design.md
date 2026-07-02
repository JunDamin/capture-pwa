# 책 표지 썸네일 — 알라딘 TTB 검색·저장 (spec)

날짜: 2026-07-02
관련: ADR-006(외부 API 없음 — 본 건으로 개정→ADR-017), ADR-015(이미지 ArrayBuffer 저장), 책 중심 전환(ADR-016)
근거: 2026-07-02 API 실측 조사 — 알라딘 TTB가 유일하게 (a) 브라우저 직접 호출(JSONP), (b) 한국서 커버리지 최상, (c) **표지 이미지 CDN이 CORS 허용 → fetch→ArrayBuffer→IndexedDB 저장 가능**.

## Context

책에 표지 썸네일을 달고 싶다(책장/홈이 풍성해짐). 서버 없는 정적 PWA라 브라우저가 직접 외부 API를 불러야 하며, 조사 결과 알라딘 TTB(JSONP + CORS 허용 이미지 CDN)가 사실상 유일한 해법. 키는 공개 리포 노출을 피해 **사용자가 설정에서 자기 TTB 키를 입력**(localStorage)하기로 확정.

## 결정

- **소스: 알라딘 TTB ItemSearch(JSONP)** — `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?ttbkey={KEY}&Query={제목}&QueryType=Title&SearchTarget=Book&MaxResults=10&Cover=Big&Output=JS&Version=20131101&callback={cb}`. `Cover=Big` → cover500(500px).
- **표지는 한 번 받아 로컬 저장**: cover URL을 `fetch`(CDN이 `ACAO:*`) → ArrayBuffer → **Book 레코드에 저장**(오프라인·외부 의존 제거). ADR-015 패턴 준수.
- **키**: transfer(백업·가져오기) 화면에 "알라딘 TTB 키" 입력 섹션 → `localStorage["aladin.ttbKey"]`. 키 없으면 표지 검색 UI만 비활성(앱 정상 동작 — 표지는 순수 부가 기능).
- 카카오 폴백은 이번에 안 함(YAGNI — 표시 전용·저해상이라 가치 낮음).

## 컴포넌트/변경

### 1. `src/db/types.ts` — Book cover 재타입 (스키마 버전 불변)
- **[검토 2] 기존 Book에 이미 `isbn?: string`(사용 중)과 `cover?: Blob`(dead — 읽는 곳 없음)이 있음.** 신규 필드 추가가 아니라 **미사용 `cover?: Blob` → `cover?: ArrayBuffer | null` 재타입** + `coverType?: string` 추가. **`isbn?`은 유지**(edit 폼이 사용).
- 표시 가드: **`book.cover instanceof ArrayBuffer`일 때만** 렌더(검토 4 — 레거시/손상 `{}` 레코드·구버전 백업 문자열 방어).

### 1b. `src/lib/backup.ts` — **[검토 1, 필수] Book 표지 직렬화**
현재 books는 raw로 `JSON.stringify`됨 → ArrayBuffer가 `{}`로 파손, import가 그 손상 레코드를 그대로 저장. **CaptureBackup 패턴 미러링:**
- `interface BookBackup extends Omit<Book, "cover"> { cover: string | null }`; `BackupBundle.books: BookBackup[]`.
- export: `cover instanceof ArrayBuffer ? await blobToDataUrl(new Blob([cover], { type: coverType ?? "image/jpeg" })) : null`.
- import: `cover: str ? await (await dataUrlToBlob(str)).arrayBuffer() : undefined`. `version: 1` 유지(선택 필드 — 구 번들 호환).

### 2. `src/lib/aladin.ts` (신규)
```ts
export interface AladinItem { title: string; author: string; cover: string; isbn13: string; publisher: string }
export function getTtbKey(): string | null;                  // localStorage
export function setTtbKey(k: string): void;
export async function searchBooks(query: string): Promise<AladinItem[]>;  // JSONP(script 주입+콜백+타임아웃 8s+정리)
export async function fetchCover(coverUrl: string): Promise<{ buf: ArrayBuffer; type: string }>; // coversum→cover500 치환 후 fetch
```
- JSONP **하드닝(검토 5)**: 전역 콜백 `done` 플래그로 이중 호출 방지; **타임아웃 시 콜백을 delete가 아니라 no-op로 교체**(늦게 도착한 스크립트의 ReferenceError 방지); 성공/에러/타임아웃 모든 경로에서 script 제거; `encodeURIComponent(제목)`; 알라딘 **errorCode 응답 감지**(무효 키도 HTTP 200) → "키를 확인해주세요".
- cover URL: `http→https` 승격 + `coversum|cover200 → cover500` 치환, **치환 URL이 실패(404)하면 원본 URL로 폴백**. 빈/placeholder(noimg) cover 항목은 결과에서 제외.
- 키: `setTtbKey`는 `trim()`(빈값=제거), `getTtbKey`는 빈 문자열이면 null. **localStorage 키 이름 `capture.aladinTtbKey`**(기존 `capture.cropFrame` 네임스페이스 일치, 검토 6) + try/catch(사파리 사생활 모드).
- 키 없으면 `searchBooks`가 명시적 에러("키 없음") — 호출부가 안내.

### 3. `src/screens/books.ts` — 표지 찾기 UI
- **[검토 8 채택] v1은 ✎ 편집 폼에만** "표지 찾기" 버튼(키 있을 때만 노출) — 신규 등록 흐름의 미저장 상태 저글링 회피(등록 후 ✎ 한 탭이면 충분). → `searchBooks(title)` → 결과 시트(표지 썸네일 `<img>` 핫링크+제목+저자, 최대 10) → 선택 → `fetchCover` → `book.cover/coverType` 저장(putBook) → 재렌더. fetch 실패 시 저장 안 함 + 토스트 + 시트 유지(재시도).
- 검색 실패/0건/타임아웃 → 토스트("표지를 찾지 못했어요"). 표지는 언제든 재검색으로 교체.
- 화면 이탈 중 in-flight JSONP: 결과 핸들러가 해체된 root를 만지지 않게 alive 플래그(또는 cleanup에서 무시).

### 4. 표시 — 홈/책장/Review
- `cover instanceof ArrayBuffer`일 때 기존 이니셜 박스(`.cover`/`.mini`) 대신 `<img>`(objectURL). **이미지는 `<img>`만 — createImageBitmap/decode 금지(ADR-013).**
- **[검토 3] objectURL 수명 관리 — 홈·책장은 현재 urls 배열이 없음(cleanup이 `()=>{}`)**: `mountHome`/`mountBooks`에 mount 스코프 `urls: string[]` 추가, 재렌더 전 revoke(books는 add/edit/del마다 재렌더) + cleanup에서 revoke — review 패턴 이식. review는 `getBook` 결과에서 title만 쓰고 버리는데, Book(또는 cover)을 보관해 hero에서 기존 urls 사이클로 렌더.
- 홈 topCard/bookItem, 책장 행, 책 Review hero. CSS: 기존 박스 크기 유지(object-fit: cover, radius 동일).

### 5. `src/screens/transfer.ts` — 설정 섹션
- 하단에 "알라딘 TTB 키" 입력(input + 저장 버튼 + 현재 상태 표시 + 발급 안내 링크 문구 "aladin.co.kr에서 무료 발급"). `setTtbKey`. 마이크로카피 plain.

### 6. 문서
- **ADR-017**: 외부 API 예외 승인 — 알라딘 TTB(JSONP·이미지 CDN CORS 실측), 키는 사용자 입력(공개 리포 비커밋), 표지는 1회 수신 후 IDB 저장. **ADR-006과 PRD §19("외부 API 없음") 함께 개정 명시**(검토 7) + JSONP 신뢰 트레이드오프 기록.
- transfer 화면 topbar 문구는 "백업·설정"으로(설정 섹션이 생기므로 — 홈 버튼 문구도 동일하게).

## 에러/엣지
- 오프라인/차단망: JSONP 타임아웃 → 토스트, 앱 무영향. 표지는 이미 저장분으로 표시.
- 키 무효/쿼터 초과: 알라딘 에러 응답 → "키를 확인해주세요" 토스트.
- JSONP는 외부 스크립트 실행(알라딘 신뢰 전제) — 개인용 수용, ADR-017에 명기.
- Book cover로 IDB 용량 증가(권당 ~50-70KB) — 무시 가능 수준.

## 검증
`npm run build` + preview(키 입력→검색→선택→표지 저장→홈/책장/Review 표시→오프라인에서도 표지 유지) + `test:pdf` PASS(무관 회귀). 실기기: iOS에서 JSONP·fetch·표시.

## 범위 밖
- 카카오 폴백, ISBN 바코드 스캔(ADR-006 Phase 2+), 표지 수동 업로드.
