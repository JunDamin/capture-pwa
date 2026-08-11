/** 요약 표지 + 사진을 단일 PDF로(자료 전용 — 지시문은 클립보드 프롬프트가 담당). 한글은 canvas 렌더(Pretendard) — jsPDF 폰트 임베딩 회피. ADR-008. */
import { jsPDF } from "jspdf";
import type { ExportContext } from "./prompt.ts";
import { captureRows, totalPhotoCount } from "./exportModel.ts";

const W = 1240;
const H = 1754;
const M = 90;
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

/**
 * Blob을 base64 dataURL로 (디코드 없이). PDF엔 이 JPEG를 jsPDF로 직접 삽입한다 —
 * iOS는 RAM이 적어 3200px 이미지의 비트맵 디코드(createImageBitmap/Image 모두)가 실패하므로,
 * 디코드를 아예 하지 않고 압축 JPEG 바이트를 그대로 PDF에 넣는다(메모리/엔진 무관).
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

export async function buildPdf(ctx: ExportContext): Promise<Blob> {
  await ensureFont();
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

  // --- 표지 1장: 요약 + 한 줄 안내 (지시문은 함께 붙여넣는 메시지가 담당 — PDF는 자료) ---
  const pg = blank();
  let y = M + 40;
  pg.g.fillStyle = INK;
  pg.g.font = "700 44px Pretendard";
  for (const ln of wrap(pg.g, `독서 캡처 — ${ctx.bookTitle}${ctx.author ? ` (${ctx.author})` : ""}`, W - M * 2)) {
    pg.g.fillText(ln, M, y);
    y += 58;
  }
  y += 10;
  pg.g.font = "400 30px Pretendard";
  const dates = captures.map((c) => c.createdAt);
  const fmtD = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };
  const period = dates.length
    ? (() => {
        const a = fmtD(Math.min(...dates));
        const b = fmtD(Math.max(...dates));
        return a === b ? a : `${a} ~ ${b}`;
      })()
    : null;
  const infoLines = [
    `범위: ${ctx.scopeLabel}${ctx.project ? ` · 목적: ${ctx.project}` : ""}`,
    period ? `기간: ${period}` : null,
    `캡처: ${captures.length}개 (사진 ${totalPhotoCount(captures)}장)`,
  ].filter(Boolean) as string[];
  for (const ln of infoLines) {
    pg.g.fillText(ln, M, y);
    y += 44;
  }
  y += 24;
  pg.g.fillStyle = SUB;
  pg.g.font = "400 26px Pretendard";
  const guide =
    "이 PDF는 독서 캡처 사진 모음입니다. 처리 지시는 함께 붙여넣은 메시지를 따르세요. " +
    "각 사진 페이지의 캡션에 태그·시각·담은 글·내 생각이 있습니다. " +
    "capture-NNa / capture-NNb로 나뉜 두 페이지는 같은 글이 이어진 것입니다.";
  for (const ln of wrap(pg.g, guide, W - M * 2)) {
    pg.g.fillText(ln, M, y);
    y += 36;
  }
  addPage(pg.c);

  // --- 사진 페이지: 사진 1장당 1페이지 (번호·태그·시각·note는 exportModel로 파생 — prompt.md와 lockstep) ---
  // 캡처에 사진이 2장이면 capture-NNa / capture-NNb 두 페이지. 캡션 전문은 첫 장에만 싣고
  // 둘째 장은 "이어짐" 한 줄만 — 사진에 더 넓은 영역을 준다(OCR 정확도 우선, ADR-020).
  for (const row of captureRows(captures)) {
    for (let j = 0; j < row.photos.length; j++) {
      const shot = row.photos[j];
      const cont = j > 0; // 이어지는 페이지
      const p = blank();
      p.g.fillStyle = INK;
      p.g.font = "700 34px Pretendard";
      p.g.fillText(shot.label, M, M);

      const availW = W - M * 2;
      const availH = H - (M + 70) - (cont ? 140 : 320);
      // 사진은 디코드 없이 JPEG를 PDF에 직접 삽입한다(addPage 뒤 doc.addImage). 여기선 dataURL+치수만 준비.
      // 한 장이 실패해도 PDF 전체가 깨지지 않게 장별 격리 — 실패 시 "텍스트만" 페이지.
      let photo: { dataUrl: string; w: number; h: number } | null = null;
      try {
        const dataUrl = await blobToDataUrl(shot.blob);
        let w = shot.width || 0;
        let h = shot.height || 0;
        if (!w || !h) {
          const props = doc.getImageProperties(dataUrl);
          w = props.width;
          h = props.height;
        }
        photo = { dataUrl, w, h };
      } catch {
        photo = null;
      }
      if (!photo) {
        p.g.fillStyle = SUB;
        p.g.font = "400 28px Pretendard";
        p.g.fillText("(사진을 불러오지 못했어요 — 텍스트만 포함)", M, M + 100);
      }

      let cy = M + 70 + availH + 24;
      const meta = [row.time, row.page ? `p.${row.page}` : null].filter(Boolean).join("  ·  ");
      if (cont) {
        p.g.fillStyle = SUB;
        p.g.font = "400 26px Pretendard";
        p.g.fillText(`${row.photos[0].label}에서 이어짐  ·  ${row.tagLabel}  ·  ${meta}`, M, cy);
      } else {
        p.g.fillStyle = INK;
        p.g.font = "600 30px Pretendard";
        p.g.fillText(`${row.tagEmoji} ${row.tagLabel}`, M, cy);
        cy += 44;
        p.g.fillStyle = SUB;
        p.g.font = "400 26px Pretendard";
        p.g.fillText(meta, M, cy);
        cy += 40;
        p.g.fillStyle = INK;
        if (row.passage) {
          for (const ln of wrap(p.g, `담은 글: ${row.passage}`, W - M * 2)) {
            p.g.fillText(ln, M, cy);
            cy += 36;
          }
        }
        if (row.note) {
          for (const ln of wrap(p.g, `내 생각: ${row.note}`, W - M * 2)) {
            p.g.fillText(ln, M, cy);
            cy += 36;
          }
        }
      }
      addPage(p.c);
      if (photo) {
        const scale = Math.min(availW / photo.w, availH / photo.h);
        const dw = photo.w * scale;
        const dh = photo.h * scale;
        // 디코드 없이 압축 JPEG를 페이지에 직접 삽입(iOS 메모리 무관).
        doc.addImage(photo.dataUrl, "JPEG", (W - dw) / 2, M + 70, dw, dh);
      }
      photo = null; // dataURL은 한 번에 하나만 살아 있게 — iOS 메모리(ADR-013/015)
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return doc.output("blob");
}
