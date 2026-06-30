/** prompt.md 본문 + 사진을 단일 PDF로. 한글은 canvas 렌더(Pretendard)로 — jsPDF 폰트 임베딩 회피. ADR-008. */
import { jsPDF } from "jspdf";
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

/**
 * Blob을 이미지로 로드.
 * - createImageBitmap: iOS Safari 15~16에서 미지원/버그 → 사용 안 함.
 * - img.decode(): iOS Safari는 blob URL 이미지에 대해 `EncodingError: Loading error.`로
 *   거부하는 WebKit 버그가 있다(실제로는 onload로 정상 로드됨) → 사용 안 함.
 * 그래서 가장 호환성 높은 onload/onerror만 쓴다(앱의 다른 화면도 같은 blob을 object URL로 잘 표시함).
 */
async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function buildPdf(ctx: ExportContext): Promise<Blob> {
  await ensureFont();
  const promptMd = buildExport(ctx).promptMd;
  const captures = ctx.captures;

  // 페이지를 쌓아두지 않고 하나씩 즉시 PDF에 넣고 canvas 백킹스토어를 해제한다.
  // (iOS Safari 메모리: 3200px 사진 다수 + 누적 canvas → 이미지 디코드 실패 onerror 방지)
  const doc = new jsPDF({ unit: "px", format: [W, H], orientation: "portrait" });
  let pageIndex = 0;
  const addPage = (canvas: HTMLCanvasElement) => {
    if (pageIndex > 0) doc.addPage([W, H], "portrait");
    doc.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", 0, 0, W, H);
    pageIndex++;
    canvas.width = 0;
    canvas.height = 0;
  };

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
      addPage(pg.c);
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
  addPage(pg.c);

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

    const availW = W - M * 2;
    const availH = H - (M + 70) - 320;
    // 한 장이 실패해도(iOS 메모리 압박으로 Image onerror 등) PDF 전체가 깨지지 않게
    // 장별로 격리: 실패 시 그 캡처는 "사진 없이 텍스트만" 페이지로.
    let img: HTMLImageElement | null = null;
    try {
      img = await loadImage(cap.image);
    } catch {
      img = null;
    }
    if (img) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.min(availW / iw, availH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      p.g.drawImage(img, (W - dw) / 2, M + 70, dw, dh);
      img.src = ""; // 디코드된 소스 이미지 즉시 해제(iOS 메모리)
    } else {
      p.g.fillStyle = SUB;
      p.g.font = "400 28px Pretendard";
      p.g.fillText("(사진을 불러오지 못했어요 — 텍스트만 포함)", M, M + 100);
    }

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
    const note = [cap.memo, cap.why].filter((s) => s && s.trim()).join(" · ");
    if (cap.passage && cap.passage.trim()) {
      for (const ln of wrap(p.g, `담은 글: ${cap.passage.trim()}`, W - M * 2)) {
        p.g.fillText(ln, M, cy);
        cy += 36;
      }
    }
    if (note) {
      for (const ln of wrap(p.g, `내 생각: ${note}`, W - M * 2)) {
        p.g.fillText(ln, M, cy);
        cy += 36;
      }
    }
    addPage(p.c);
    // iOS가 직전 이미지 디코드 메모리를 회수할 틈을 준다(연속 대용량 디코드 실패 완화).
    await new Promise((r) => setTimeout(r, 0));
  }

  return doc.output("blob");
}
