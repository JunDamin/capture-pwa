# 서브프로젝트 2 — 데이터 이식: JSON 백업 + 가져오기 설계 (spec)

날짜: 2026-06-30
관련: PRD §12(저장), ADR-003(이미지 Blob)/005(세션), docs/design-language.md

## Context

이 앱은 서버·로그인 없이 IndexedDB에 로컬 저장한다(서브프로젝트 1과 독립). 사용자는 데이터를 **백업하고 다른 기기로 옮겨 완전 복원**하고 싶다. 현재는 그 수단이 없다(Export는 AI 핸드오프용 산출물이고, 앱으로 다시 못 들인다).

목표: 모든 데이터를 **단일 .json 한 파일로 백업**하고, 다른 기기(또는 같은 기기)에서 **가져오기로 책·세션·캡처를 그대로 복원**한다. uuid 기준 upsert라 같은 파일을 여러 번 가져와도 중복이 생기지 않는다.

## 범위

포함: 전체 데이터 JSON 백업(단일 파일 다운로드), 가져오기 화면/흐름(파일 선택 → 복원), uuid 기준 upsert 복원, 진입점(Home).
범위 밖: PDF/AI 핸드오프(서브프로젝트 1), 부분 선택 백업, 자동/클라우드 동기화, 충돌 수동 병합 UI(upsert로 단순화).

## 데이터 모델 / 스키마

이미지는 Blob이므로 JSON엔 base64 dataURL로 직렬화한다.

```ts
export interface BackupBundle {
  version: 1;
  exportedAt: number;           // epoch ms (호출부에서 주입)
  books: Book[];                // 그대로
  sessions: Session[];          // 그대로 (started/ended 숫자)
  captures: CaptureBackup[];    // image만 base64로 치환
}
export interface CaptureBackup extends Omit<Capture, "image"> {
  image: string | null;         // dataURL("data:image/jpeg;base64,...") 또는 null
}
```
- `page?`(서브프로젝트 외 기존 필드)도 그대로 포함 — `Capture` 전체를 직렬화하므로 스키마 진화에 견고.
- `version`으로 향후 마이그레이션 여지. 가져오기는 `version === 1`만 수용, 그 외엔 안내.

## 데이터 계층 (`src/db/db.ts` 수정)

추가 함수(기존 패턴 따름):
```ts
export async function allSessions(): Promise<Session[]> { return (await db()).getAll("sessions"); }
export async function allCaptures(): Promise<Capture[]> { return (await db()).getAll("captures"); }
// books는 기존 listBooks() 재사용
```
복원 upsert는 기존 `putBook`/`putSession`/`updateCapture`(=put) 재사용 — 새 트랜잭션 함수 없이 루프 put. (수백 건 수준 가정, 단순함 우선.)

## 직렬화/역직렬화 (`src/lib/backup.ts` 신규) — 깊은 모듈

```ts
export async function buildBackup(now: number): Promise<Blob>          // 전체 → JSON Blob
export interface ImportResult { books: number; sessions: number; captures: number }
export async function importBackup(text: string): Promise<ImportResult> // 파싱·검증·upsert, 복원 건수 반환
```
- `buildBackup`: `listBooks`/`allSessions`/`allCaptures` 수집 → 각 캡처 `image` Blob을 `blobToDataURL`로 변환 → `JSON.stringify(bundle)` → `new Blob([json], {type:"application/json"})`.
- `importBackup`: `JSON.parse` → `version===1` 검증(아니면 throw) → books/sessions putBook/putSession → captures는 dataURL→Blob(`dataUrlToBlob`) 복원 후 put. 각 카운트 집계 반환.
- Blob↔dataURL 헬퍼는 이 모듈 내부(FileReader / fetch(dataURL).blob()).

## 화면 / 라우팅

- 새 라우트(`src/app.ts`): `{ name: "transfer" }` → `mountTransfer(root, nav)`.
- 새 화면 `src/screens/transfer.ts`:
  - 상단바 ‹ 뒤로(홈) + 제목 "백업·가져오기".
  - **백업** 카드: 설명 + 하단 "💾 백업 파일 내려받기" → `buildBackup(Date.now())` → `downloadFile`(파일명 `capture-backup-YYYYMMDD.json`). 토스트 "백업 파일을 내려받았어요".
  - **가져오기** 카드: 숨은 `<input type="file" accept="application/json,.json">` + "📥 백업 파일 선택" 버튼. 선택 시 파일 텍스트 읽어 `importBackup` → 결과 토스트 "책 N · 세션 N · 캡처 N 복원했어요". 실패 시 "백업 파일을 읽지 못했어요(형식 확인)".
  - 가져오기 직후 데이터가 바뀌므로 안내: 완료 후 "홈으로" 버튼 노출(홈 재진입 시 endStaleSessions 등 기존 부팅 로직 통과).
- 진입점: `src/screens/home.ts` — 하단에 작은 텍스트 링크/버튼 "백업·가져오기" 추가 → `nav({ name: "transfer" })`. (전역 동작이므로 세션/책 스코프와 무관하게 Home에 둔다.)

## 디자인 언어 준수

- 밝은 토스-클린, 카드형. 주 동작은 `.btn-primary`(파랑), 보조는 `.btn-ghost`.
- 마이크로카피 plain·sentence case: "백업 파일 내려받기", "백업 파일 선택", "…복원했어요". 사과 없는 에러 안내.
- Home 진입점은 과하지 않게(작은 보조 링크).

## 에러 처리 / 엣지

- 잘못된 JSON/버전 → throw → 화면 토스트로 안내, 데이터 변경 없음(파싱 단계에서 중단).
- 부분 손상: 가능한 항목만 복원하기보다 **버전·구조 검증 후 일괄 처리**(단순·예측 가능). 검증 실패면 아무것도 안 들임.
- 큰 base64(이미지 다수)로 메모리/시간 ↑ 가능 — 수백 건 가정, 진행 토스트로 체감 완화. (스트리밍/청크는 범위 밖.)
- uuid 충돌 = 같은 레코드 → put로 덮어씀(의도된 복원/병합).

## 검증 (Verification)

테스트 프레임워크 없음 → `npm run build`(tsc) + `npm run preview` 수동.
1. `npm run build` 무에러.
2. preview: 책·세션·캡처(사진 포함) 만든 뒤 → 백업 → .json 다운로드. JSON 열어 books/sessions/captures + image dataURL 확인.
3. 브라우저 IndexedDB 비우기(또는 다른 프로파일) → 가져오기 → 같은 .json 선택 → 홈/Review에 책·세션·캡처·사진 그대로 복원 확인.
4. 같은 파일 두 번 가져오기 → 중복 안 생김(uuid upsert), 카운트 동일.
5. 잘못된 파일(텍스트/다른 json) 선택 → 안내 토스트, 데이터 무변경.

## 미해결/주의

- 대용량(이미지 수백 장) 시 base64 메모리. 현실 사용 규모에선 허용 가정; 필요 시 후속 청크 처리.
- 가져오기 진입점을 Home 보조 링크로 둠 — 설정 화면이 생기면 거기로 이동 검토(현재 설정 화면 없음).
