/** Export — prompt.md + 사진 공유(ADR-008). 1순위 Web Share, 보조 복사/다운로드. PRD §8-D. */
import type { Nav, Scope } from "../app.ts";
import {
  addCapture,
  capturesForBook,
  capturesForSession,
  getBook,
  getSession,
} from "../db/db.ts";
import type { Capture } from "../db/types.ts";
import { buildExport, type ExportContext, type ExportPackage } from "../lib/prompt.ts";
import { canShareFiles, copyText, downloadFile, shareFiles } from "../lib/share.ts";
import { buildPdf } from "../lib/pdf.ts";

export function mountExport(root: HTMLElement, nav: Nav, scope: Scope, id: string): () => void {
  root.innerHTML = `<div class="scr scr--light"><div class="loading">패키지 만드는 중…</div></div>`;

  (async () => {
    let caps: Capture[];
    let ctx: ExportContext;
    if (scope === "session") {
      const s = await getSession(id);
      if (!s) return nav({ name: "home" });
      const book = await getBook(s.bookId);
      caps = await capturesForSession(id);
      ctx = {
        bookTitle: book?.title ?? "(책)",
        author: book?.author,
        project: s.project,
        scopeLabel: "이번 회독",
        captures: caps,
      };
    } else {
      const book = await getBook(id);
      caps = await capturesForBook(id);
      ctx = { bookTitle: book?.title ?? "(책)", author: book?.author, scopeLabel: "이 책 전체", captures: caps };
    }
    render(buildExport(ctx), caps, ctx.bookTitle, ctx);
  })();

  function render(pkg: ExportPackage, caps: Capture[], title: string, ctx: ExportContext) {
    root.innerHTML = `
    <div class="scr scr--light export">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">Export</div>
      </div>

      <div class="card">
        <div class="exp__title">📤 ${esc(title)}</div>
        <div class="exp__stats">
          <span>📝 prompt.md</span><span>·</span>
          <span>📷 사진 ${pkg.imageCount}</span><span>·</span>
          <span>🗂 캡처 ${caps.length}</span>
        </div>
        <div class="exp__how">
          첨부된 <b>prompt.md</b>와 사진을 ChatGPT·Claude에 함께 넘기면,
          AI가 사진을 OCR하고 주제·관계·독서노트를 만들어 줍니다.
        </div>
      </div>

      <button class="btn-primary topdf">📄 PDF로 내보내기 (AI에게 넘기기)</button>
      <div class="exp__alt">
        <button class="btn-ghost copy">📋 프롬프트 복사</button>
      </div>

      <div class="card card--list">
        <div class="card__h">prompt.md 미리보기</div>
        <pre class="promptview">${esc(pkg.promptMd)}</pre>
      </div>

      <div class="toast" hidden></div>
    </div>`;

    const toast = root.querySelector(".toast") as HTMLElement;
    const flash = (msg: string) => {
      toast.textContent = msg;
      toast.hidden = false;
      setTimeout(() => (toast.hidden = true), 2200);
    };

    (root.querySelector(".back") as HTMLElement).onclick = () =>
      nav({ name: "review", scope, id });

    (root.querySelector(".topdf") as HTMLButtonElement).onclick = async () => {
      const btn = root.querySelector(".topdf") as HTMLButtonElement;
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "PDF 만드는 중…";
      try {
        // 클립보드 복사를 먼저: iOS Safari는 buildPdf await 이후 제스처 활성화가 만료됨
        const copied = await copyText(pkg.promptMd);
        const safe = title.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 40);
        const name = `독서캡처-${safe}-${scope === "session" ? "회독" : "책"}.pdf`;
        const blob = await buildPdf(ctx);
        const file = { name, blob };
        if (canShareFiles([file])) {
          const r = await shareFiles([file], `독서 캡처 — ${title}`, pkg.promptMd);
          if (r === "shared") {
            await markExported(caps);
            flash(copied ? "공유했어요 · 프롬프트 복사됨 — 붙여넣고 보내세요" : "공유했어요");
          } else if (r === "unsupported") {
            downloadFile(file);
            flash(copied ? "PDF 내려받음 · 프롬프트 복사됨 — 붙여넣으세요" : "PDF를 내려받아요");
          } else if (r !== "cancelled") {
            flash("공유 중 문제가 생겼어요");
          }
        } else {
          downloadFile(file);
          await markExported(caps);
          flash(copied ? "PDF 내려받음 · 프롬프트 복사됨 — 붙여넣으세요" : "PDF를 내려받아요");
        }
      } catch (e) {
        console.error("buildPdf failed", e);
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        flash(`PDF를 만들지 못했어요 — ${msg}`);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    };

    (root.querySelector(".copy") as HTMLButtonElement).onclick = async () => {
      flash((await copyText(pkg.promptMd)) ? "프롬프트를 복사했어요" : "복사에 실패했어요");
    };
  }

  async function markExported(caps: Capture[]) {
    for (const c of caps) {
      if (c.exportStatus !== "exported") await addCapture({ ...c, exportStatus: "exported" });
    }
  }

  return () => {};
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
