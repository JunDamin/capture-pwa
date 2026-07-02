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

### 1. `src/db/types.ts` — Book 확장 (스키마 버전 불변)
```ts
export interface Book {
  uuid: string;
  title: string;
  author?: string;
  cover?: ArrayBuffer | null;   // 표지(저장형 그대로 ArrayBuffer — ADR-015)
  coverType?: string;           // MIME (기본 image/jpeg)
}
```
- 선택 필드 추가 — 마이그레이션·백업 자연 호환(단, backup.ts가 Book을 JSON 직렬화한다면 ArrayBuffer 처리 필요 → **검토 확인 사항**: 현재 backup이 book을 어떻게 직렬화하는지; 캡처 이미지처럼 base64 변환이 필요하면 동일 패턴 적용).

### 2. `src/lib/aladin.ts` (신규)
```ts
export interface AladinItem { title: string; author: string; cover: string; isbn13: string; publisher: string }
export function getTtbKey(): string | null;                  // localStorage
export function setTtbKey(k: string): void;
export async function searchBooks(query: string): Promise<AladinItem[]>;  // JSONP(script 주입+콜백+타임아웃 8s+정리)
export async function fetchCover(coverUrl: string): Promise<{ buf: ArrayBuffer; type: string }>; // coversum→cover500 치환 후 fetch
```
- JSONP: `<script src=...callback=__aladinCb_N>` 주입, 전역 콜백 1회성, 타임아웃/에러 시 reject + script 제거. cover URL은 `coversum|cover200` → `cover500` 치환(실측 확인된 트릭).
- 키 없으면 `searchBooks`가 명시적 에러("키 없음") — 호출부가 안내.

### 3. `src/screens/books.ts` — 표지 찾기 UI
- 새 책 등록 폼과 기존 책 ✎ 편집에 **"표지 찾기"** 버튼(키 있을 때만 노출) → `searchBooks(title)` → 결과 시트(표지 썸네일 `<img>`+제목+저자, 최대 10) → 선택 → `fetchCover` → `book.cover/coverType` 저장(putBook) → 목록 재렌더.
- 검색 실패/0건/타임아웃 → 토스트("표지를 찾지 못했어요"). 표지는 언제든 재검색으로 교체 가능.

### 4. 표시 — 홈/책장/Review
- `cover`가 있으면 기존 이니셜 박스(`.cover`/`.mini`) 대신 `<img>`(objectURL — 렌더 시 생성, cleanup에서 revoke: review의 기존 urls 패턴 재사용).
- 홈 topCard/bookItem, 책장 행, 책 Review hero. CSS: 기존 박스 크기 유지(cover 이미지 object-fit: cover, radius 동일).

### 5. `src/screens/transfer.ts` — 설정 섹션
- 하단에 "알라딘 TTB 키" 입력(input + 저장 버튼 + 현재 상태 표시 + 발급 안내 링크 문구 "aladin.co.kr에서 무료 발급"). `setTtbKey`. 마이크로카피 plain.

### 6. 문서
- **ADR-017**: 외부 API 예외 승인 — 알라딘 TTB(JSONP·이미지 CDN CORS 실측), 키는 사용자 입력(공개 리포 비커밋), 표지는 1회 수신 후 IDB 저장. ADR-006 개정.

## 에러/엣지
- 오프라인/차단망: JSONP 타임아웃 → 토스트, 앱 무영향. 표지는 이미 저장분으로 표시.
- 키 무효/쿼터 초과: 알라딘 에러 응답 → "키를 확인해주세요" 토스트.
- JSONP는 외부 스크립트 실행(알라딘 신뢰 전제) — 개인용 수용, ADR-017에 명기.
- Book cover로 IDB 용량 증가(권당 ~50-70KB) — 무시 가능 수준.

## 검증
`npm run build` + preview(키 입력→검색→선택→표지 저장→홈/책장/Review 표시→오프라인에서도 표지 유지) + `test:pdf` PASS(무관 회귀). 실기기: iOS에서 JSONP·fetch·표시.

## 범위 밖
- 카카오 폴백, ISBN 바코드 스캔(ADR-006 Phase 2+), 표지 수동 업로드.
