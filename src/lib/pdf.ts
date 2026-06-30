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
