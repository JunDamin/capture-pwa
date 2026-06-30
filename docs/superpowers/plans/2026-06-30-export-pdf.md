# Export 단일 PDF (AI 핸드오프) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export의 "AI에게 넘기기"를 사진 포함 단일 PDF 하나로 만든다(한글은 canvas 렌더로 처리).

**Architecture:** 새 모듈 `src/lib/pdf.ts`가 각 PDF 페이지를 canvas에 렌더(self-host Pretendard)한 뒤 JPEG로 jsPDF 페이지에 넣어 폰트 임베딩 없이 한글+사진을 담는다. jsPDF는 export 시 동적 import. Export 화면은 다중 파일 공유/개별 다운로드를 PDF 생성+공유/다운로드로 교체하고 "프롬프트 복사"는 유지.

**Tech Stack:** Vanilla TS + Vite, jsPDF(신규, 동적 import), Canvas 2D, 기존 `lib/prompt.ts`/`lib/share.ts`.

## Testing approach (이 저장소 적응)

테스트 프레임워크 없음. 각 태스크 검증 = `npm run build`(tsc) + `npm run preview` 수동 + 커밋.

## Global Constraints

- 마이크로카피 기존 문자열/일관 유지: "프롬프트 복사", "저장"; 신규는 plain·sentence case("PDF로 내보내기", "PDF 만드는 중…", 에러는 사과 없이 안내).
- 색/모양: 밝은 토스-클린, 주 CTA = 하단 풀폭 파랑 `.btn-primary`. PDF 내부는 흰 배경·잉크 텍스트·사진 크게.
- jsPDF는 **동적 import**(`await import("jspdf")`) — 초기 로드/캡처 3초 루프 영향 금지.
- 사진 OCR 위해 PDF 이미지 품질 과하게 낮추지 않기(JPEG ~0.85).
- 기존 `buildExport(ctx).promptMd` 텍스트를 PDF 본문 소스로 **재사용**(프롬프트 문구 중복 작성 금지).

---

### Task 1: `src/lib/pdf.ts` — canvas 렌더 PDF 빌더 + jspdf 의존성

**Files:**
- Create: `src/lib/pdf.ts`
- Modify: `package.json` (jspdf 의존성)

**Interfaces:**
- Consumes: `buildExport`, `ExportContext` from `./prompt.ts`; `TAGS`, `Capture` from `../db/types.ts`.
- Produces: `buildPdf(ctx: ExportContext): Promise<Blob>` — 단일 PDF Blob.

- [ ] **Step 1: jspdf 설치**

Run: `cd /root/captureApp && npm install jspdf`
Expected: package.json dependencies에 `jspdf` 추가, 에러 없음.

- [ ] **Step 2: `src/lib/pdf.ts` 작성**

```typescript
/** prompt.md 본문 + 사진을 단일 PDF로. 한글은 canvas 렌더(Pretendard)로 — jsPDF 폰트 임베딩 회피. ADR-008. */
import { buildExport, type ExportContext } from "./prompt.ts";
import { TAGS, type Capture } from "../db/types.ts";

const W = 1240;
const H = 1754;
const M = 90;
const LINE = 40;
const INK = "#191F28";
const SUB = "#8B95A1";

async function ensureFont(): Promise<void> {
  const f = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!f) return;
  try {
    await Promise.all([
      f.load("700 40px Pretendard"),
      f.load("600 30px Pretendard"),
      f.load("400 28px Pretendard"),
    ]);
  } catch {
    /* 폰트 로드 실패 시 기본 폰트로 진행 */
  }
}

function blank(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  g.textBaseline = "top";
  return { c, g };
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (!raw) {
      out.push("");
      continue;
    }
    let line = "";
    for (const ch of raw) {
      if (g.measureText(line + ch).width > maxW && line) {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function buildPdf(ctx: ExportContext): Promise<Blob> {
  await ensureFont();
  const promptMd = buildExport(ctx).promptMd;
  const captures = ctx.captures;
  const pages: HTMLCanvasElement[] = [];

  // --- 텍스트 페이지: 프롬프트 본문 ---
  let pg = blank();
  let y = M;
  const setBody = () => {
    pg.g.fillStyle = INK;
    pg.g.font = "400 28px Pretendard";
  };
  setBody();
  for (const ln of wrap(pg.g, promptMd, W - M * 2)) {
    if (y > H - M) {
      pages.push(pg.c);
      pg = blank();
      setBody();
      y = M;
    }
    if (ln.startsWith("# ")) {
      pg.g.font = "700 40px Pretendard";
      pg.g.fillText(ln.slice(2), M, y);
      y += 54;
      setBody();
    } else if (ln.startsWith("## ")) {
      pg.g.font = "700 32px Pretendard";
      pg.g.fillText(ln.slice(3), M, y);
      y += 46;
      setBody();
    } else if (ln.startsWith("### ")) {
      pg.g.font = "600 30px Pretendard";
      pg.g.fillText(ln.slice(4), M, y);
      y += 42;
      setBody();
    } else {
      pg.g.fillText(ln, M, y);
      y += LINE;
    }
  }
  pages.push(pg.c);

  // --- 사진 페이지: 사진 있는 캡처마다 ---
  for (let i = 0; i < captures.length; i++) {
    const cap: Capture = captures[i];
    if (!cap.image) continue;
    const p = blank();
    const num = `capture-${String(i + 1).padStart(2, "0")}`;
    const tag = TAGS.find((t) => t.key === cap.tag)!;
    p.g.fillStyle = INK;
    p.g.font = "700 34px Pretendard";
    p.g.fillText(num, M, M);

    const bmp = await createImageBitmap(cap.image);
    const availW = W - M * 2;
    const availH = H - (M + 70) - 320;
    const scale = Math.min(availW / bmp.width, availH / bmp.height);
    const dw = bmp.width * scale;
    const dh = bmp.height * scale;
    p.g.drawImage(bmp, (W - dw) / 2, M + 70, dw, dh);
    bmp.close?.();

    let cy = M + 70 + availH + 24;
    p.g.fillStyle = INK;
    p.g.font = "600 30px Pretendard";
    p.g.fillText(`${tag.emoji} ${tag.label}`, M, cy);
    cy += 44;
    p.g.fillStyle = SUB;
    p.g.font = "400 26px Pretendard";
    const meta = [fmtTime(cap.createdAt), cap.page ? `p.${cap.page}` : null]
      .filter(Boolean)
      .join("  ·  ");
    p.g.fillText(meta, M, cy);
    cy += 40;
    p.g.fillStyle = INK;
    for (const ln of wrap(p.g, `왜: ${cap.why ?? "(없음)"}`, W - M * 2)) {
      p.g.fillText(ln, M, cy);
      cy += 36;
    }
    if (cap.memo) {
      for (const ln of wrap(p.g, `메모: ${cap.memo}`, W - M * 2)) {
        p.g.fillText(ln, M, cy);
        cy += 36;
      }
    }
    pages.push(p.c);
  }

  // --- jsPDF 조립 (동적 import) ---
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "px", format: [W, H], orientation: "portrait" });
  pages.forEach((c, i) => {
    if (i > 0) doc.addPage([W, H], "portrait");
    doc.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, W, H);
  });
  return doc.output("blob");
}
```

- [ ] **Step 3: 빌드 + 동적 청크 확인**

Run: `npm run build`
Expected: 에러 없음. 빌드 출력에 jspdf가 **별도 청크**(예: `dist/assets/jspdf-*.js`)로 분리되어 main 번들에 안 섞임(동적 import 효과).

- [ ] **Step 4: Commit**

```bash
git add src/lib/pdf.ts package.json package-lock.json
git commit -m "feat: 단일 PDF 빌더(canvas 렌더로 한글, jspdf 동적 import)"
```

---

### Task 2: Export 화면을 PDF 중심으로 재배선

**Files:**
- Modify: `src/screens/export.ts`

**Interfaces:**
- Consumes: `buildPdf` from `../lib/pdf.ts`(Task 1); 기존 `shareFiles`,`downloadFile`,`copyText`,`canShareFiles` from `../lib/share.ts`; 기존 `buildExport`.
- Produces: 사용자 동작 — PDF 생성 후 공유/다운로드 + 프롬프트 복사.

- [ ] **Step 1: import에 buildPdf 추가, 불필요 정리**

`src/screens/export.ts` 상단 import에 추가:

```typescript
import { buildPdf } from "../lib/pdf.ts";
```

(기존 `buildExport`/share 함수 import는 유지. `canShareFiles`는 PDF 단일 파일 지원 판단에 계속 사용.)

- [ ] **Step 2: 액션 영역 마크업 교체**

`render()`의 share 버튼 + `exp__alt`(기존 다중파일 공유/개별 다운로드) 블록을 다음으로 교체:

```typescript
      <button class="btn-primary topdf">📄 PDF로 내보내기 (AI에게 넘기기)</button>
      <div class="exp__alt">
        <button class="btn-ghost copy">📋 프롬프트 복사</button>
      </div>
```

- [ ] **Step 3: PDF 생성 + 공유/다운로드 핸들러로 교체**

`render()`에서 기존 `.share`/`.dl` 핸들러를 제거하고, `.copy` 핸들러는 유지하며, `.topdf` 핸들러를 추가:

```typescript
    (root.querySelector(".topdf") as HTMLButtonElement).onclick = async () => {
      const btn = root.querySelector(".topdf") as HTMLButtonElement;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "PDF 만드는 중…";
      try {
        const safe = title.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 40);
        const name = `독서캡처-${safe}-${scope === "session" ? "세션" : "책"}.pdf`;
        const blob = await buildPdf(buildCtx());
        const file = { name, blob };
        if (canShareFiles([file])) {
          const r = await shareFiles([file], `독서 캡처 — ${title}`);
          if (r === "shared") {
            await markExported(caps);
            flash("공유했어요");
          } else if (r === "unsupported") {
            downloadFile(file);
            flash("PDF를 내려받아요");
          } else if (r !== "cancelled") {
            flash("공유 중 문제가 생겼어요");
          }
        } else {
          downloadFile(file);
          await markExported(caps);
          flash("PDF를 내려받아요");
        }
      } catch (e) {
        console.error("buildPdf failed", e);
        flash("PDF를 만들지 못했어요");
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    };

    (root.querySelector(".copy") as HTMLButtonElement).onclick = async () => {
      flash((await copyText(pkg.promptMd)) ? "프롬프트를 복사했어요" : "복사에 실패했어요");
    };
```

**주의:** `buildCtx()`가 필요하다 — 현재 `mountExport`는 `ctx`를 비동기 블록 안 지역변수로 만들고 `render(buildExport(ctx), caps, ctx.bookTitle)`로 넘긴다. PDF는 `ExportContext`가 필요하므로, `ctx`를 `render`에 전달하도록 시그니처를 넓힌다(아래 Step 4).

- [ ] **Step 4: `render`가 `ctx`를 받도록 조정**

`mountExport`에서 `render` 시그니처를 `render(pkg, caps, title, ctx)`로 바꾸고 호출부 `render(buildExport(ctx), caps, ctx.bookTitle, ctx)`로 변경. Step 3의 핸들러에서 `buildCtx()` 대신 클로저의 `ctx`를 직접 사용:

```typescript
  function render(pkg: ExportPackage, caps: Capture[], title: string, ctx: ExportContext) {
```
그리고 Step 3에서 `await buildPdf(buildCtx())` → `await buildPdf(ctx)`.

`import` 줄에 `ExportContext` 타입이 이미 있는지 확인(`import { buildExport, type ExportContext, type ExportPackage } from "../lib/prompt.ts";` — 없으면 `ExportContext` 추가).

- [ ] **Step 5: 빌드 + 수동 확인**

Run: `npm run build` → 무에러.
Run: `npm run preview` → 사진 포함/미포함 캡처 섞어 만든 뒤 Export →
- "PDF로 내보내기" → (PC) PDF 1개 다운로드. 열어서 1)지시 페이지 한글 정상 2)사진 페이지 + 캡션(태그/시간/페이지/왜/메모) 확인.
- "프롬프트 복사" → 클립보드에 prompt 텍스트.
- 기존 다중파일 버튼이 사라졌는지 확인.

- [ ] **Step 6: Commit**

```bash
git add src/screens/export.ts
git commit -m "feat: Export를 단일 PDF 중심으로(다중파일 제거, 프롬프트 복사 유지)"
```

---

## Self-Review

**1. Spec coverage:** 단일 PDF(canvas 렌더, 한글) → Task1 ✓; Export 용도별 분리/프롬프트 복사 유지/다중파일 제거 → Task2 ✓; jsPDF 동적 import → Task1 Step3 확인 ✓; buildExport promptMd 재사용 → Task1 ✓.
**2. Placeholder scan:** 모든 코드 단계 실제 코드 포함. ✓
**3. Type consistency:** `buildPdf(ctx: ExportContext): Promise<Blob>`(Task1) ↔ Task2 `await buildPdf(ctx)` 일치 ✓; `ExportContext`/`ExportPackage` from prompt.ts 일치 ✓; `markExported`/`caps`/`flash`/`title`/`scope`는 기존 export.ts 스코프 내 존재(Task2가 동일 함수 내에서 사용) ✓.

## 참고
- `flash`, `markExported`, `esc`, `caps`, `title`, `scope`는 기존 `export.ts` 내부에 이미 정의됨. Task2는 같은 파일 내 수정이라 그대로 접근 가능.
