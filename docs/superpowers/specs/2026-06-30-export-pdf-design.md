# 서브프로젝트 1 — AI 핸드오프: 단일 PDF Export 설계 (spec)

날짜: 2026-06-30
관련: PRD §8-D (Export), ADR-008(전달)/009(prompt 템플릿), docs/design-language.md

## Context

현재 Export는 **prompt.md 1개 + 사진 N개**(`capture-NN.jpg`) = 총 N+1개 파일을 만든다(`src/lib/prompt.ts` `buildExport`). 전달은 모바일 Web Share(한 번에)와 보조(프롬프트 복사, 파일 *개별* 다운로드)다.

문제: PC엔 Web Share가 없어 N+1개를 일일이 받아 AI에 다시 올려야 하고, 파일이 흩어져 번거롭다. 목표: **AI(ChatGPT/Claude)에 넘기기를 단일 PDF 하나로** 만들어 PC·모바일 모두 파일 하나만 전달하면 되게 한다. AI는 PDF를 네이티브로 읽어(텍스트 + 사진 vision/OCR) 기존 프롬프트 워크플로를 그대로 수행한다.

이 앱은 서버·로그인 없음(ADR) — 클라우드/링크 방식은 범위 밖.

## 범위

포함: Export 화면을 용도별로 분리하고, "AI에게 넘기기"가 **단일 PDF**를 생성·공유/다운로드하게 한다. 기존 "프롬프트 복사"(텍스트)는 보조로 유지.
범위 밖: 백업/가져오기(서브프로젝트 2), 기존 개별 사진 다운로드(PDF로 대체되어 제거).

## 핵심 기술 결정: 한글 PDF는 canvas-렌더 페이지로

jsPDF 기본 폰트는 한글 미지원이고, 한글 폰트 임베딩은 무겁고 런타임 서브셋이 복잡하다. 그래서 **각 PDF 페이지를 canvas에 렌더한 뒤(이미 self-host된 Pretendard 사용) 그 canvas를 JPEG 이미지로 PDF 페이지에 넣는다.** 폰트 임베딩 없이 한글이 정확히 렌더되고, 사진도 같은 방식으로 페이지에 들어가며, AI는 페이지 이미지를 vision-OCR한다.

- 렌더 전 `await document.fonts.load('700 24px Pretendard')` 등으로 Pretendard 로드 보장.
- jsPDF는 **export 시 동적 import**(`await import('jspdf')`) — 별도 청크라 초기 로드·캡처 3초 루프에 영향 없음.
- 의존성 추가: `jspdf`(package.json). 이미지 페이지는 jsPDF `addImage(dataURL,'JPEG',...)`.

## 컴포넌트

### 1. `src/lib/pdf.ts` (신규) — 깊은 모듈

인터페이스(작게):
```ts
export async function buildPdf(ctx: ExportContext): Promise<Blob>
```
- `ExportContext`는 `lib/prompt.ts`의 기존 타입 재사용(bookTitle, author, project, scopeLabel, captures).
- 내부:
  1. 페이지 크기 고정(예: A4 비율, px 단위 — 폭 1240 × 높이 1754 @150dpi 근사). DPR 고려해 canvas 해상도 ↑.
  2. **표지/지시 페이지**: 제목·범위·캡처 수 + 기존 `prompt.md` 본문(지시/태그 범례/규칙 분류)을 canvas에 줄바꿈 렌더. 긴 텍스트는 여러 페이지로 분할.
  3. **캡처 페이지(들)**: 각 캡처마다 사진(가로/세로 비율 유지해 페이지에 맞춤) + 캡션(`capture-NN`, 태그 이모지+라벨, 시간, 페이지, 왜, 메모)을 canvas에 렌더. 사진 없으면 메모 중심.
  4. 각 canvas → `toDataURL('image/jpeg', 0.8)` → jsPDF 페이지로 추가.
  5. `doc.output('blob')` 반환.
- 텍스트 줄바꿈/페이지 분할은 canvas `measureText` 기반 헬퍼로(모듈 내부 비공개).
- 프롬프트 본문 텍스트는 `buildExport`가 만드는 `promptMd`를 **재사용**(중복 작성 금지) — `buildExport(ctx).promptMd`를 PDF 표지/지시 페이지의 소스로 쓴다.

### 2. `src/screens/export.ts` (수정) — 용도별 분리

- 주 버튼을 **"📄 PDF로 내보내기 (AI에게 넘기기)"** 로. 클릭 시 `buildPdf(ctx)` → `shareFiles([{name, blob}], title)`(Web Share) 시도, 미지원이면 `downloadFile`로 PDF 내려받기. 진행 중 로딩 표시("PDF 만드는 중…").
- 파일명: `독서캡처-<책제목>-<scope>.pdf`(안전 문자만).
- 보조: **"📋 프롬프트 복사"**(기존 `copyText(promptMd)`) 유지.
- 제거: 기존 다중 파일 Web Share 버튼 + "파일 내려받기"(개별 N개) — PDF가 대체.
- 공유 성공 시 기존 `markExported(caps)` 유지.
- prompt.md 미리보기(`pre.promptview`)는 유지(사용자가 내용 확인).

### 3. `src/lib/share.ts` — 변경 없음

기존 `shareFiles`/`downloadFile`/`copyText` 그대로 사용(단일 PDF도 동일 인터페이스).

## 데이터 흐름

Export 화면 진입 → 기존대로 `caps`/`ctx` 구성 → "PDF로 내보내기" → `buildPdf(ctx)`(동적 import jsPDF, canvas 렌더) → Blob → Web Share or 다운로드 → `markExported`.

## 디자인 언어 준수

- Export 화면은 밝은 토스-클린 유지. 주 CTA = 하단 풀폭 파랑(기존 `.btn-primary`).
- 마이크로카피: "PDF로 내보내기", "프롬프트 복사", "PDF 만드는 중…" — plain·sentence case. 액션 일관.
- PDF 내부 디자인은 가독 위주(흰 배경, 잉크 텍스트, 사진 크게). 과한 장식 금지.

## 에러 처리

- `buildPdf` 실패(이미지 디코드 등) → 토스트 "PDF를 만들지 못했어요" + 콘솔 로그. 화면 유지.
- 사진 없는 캡처만 있어도 텍스트 페이지로 정상 생성.
- Web Share 취소/미지원은 기존 분기 재사용(다운로드 폴백).

## 검증 (Verification)

테스트 프레임워크 없음 → `npm run build`(tsc) + `npm run preview` 수동.
1. `npm run build` 무에러. jsPDF가 별도 청크로 분리되는지 빌드 출력 확인(동적 import).
2. preview: 캡처 몇 개(사진 포함/미포함 섞어) 후 Export → "PDF로 내보내기" → PDF 1개 생성. 열어서 표지(지시문 한글 정상)·사진 페이지·캡션 확인.
3. PC 크롬: Web Share 미지원 → PDF 다운로드 폴백 동작.
4. 생성 PDF를 실제 ChatGPT/Claude에 올려 한글 지시 읽힘 + 사진 OCR 되는지(수동, 권장).
5. 초기 로드/캡처 루프에 jsPDF 영향 없음(동적 import 확인).

## 미해결/주의

- PDF 페이지 픽셀 크기·DPI·JPEG 품질은 용량 vs 가독 균형으로 구현 중 실측(사진 OCR 위해 너무 낮추지 않기).
- 캡처가 많으면 PDF가 길고 무거워짐 — 사진은 이미 압축본(≤500KB) 재사용하므로 과도하지 않음. 수십 장 수준 가정.
