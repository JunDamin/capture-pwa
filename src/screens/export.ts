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
        scopeLabel: "이번 세션",
        captures: caps,
      };
    } else {
      const book = await getBook(id);
      caps = await capturesForBook(id);
      ctx = { bookTitle: book?.title ?? "(책)", author: book?.author, scopeLabel: "이 책 전체", captures: caps };
    }
    render(buildExport(ctx), caps, ctx.bookTitle);
  })();

  function render(pkg: ExportPackage, caps: Capture[], title: string) {
    const shareable = canShareFiles(pkg.files);

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

      <button class="btn-primary share">${shareable ? "📲 공유하기 (prompt.md + 사진)" : "📲 공유 미지원 — 아래로 진행"}</button>
      <div class="exp__alt">
        <button class="btn-ghost copy">📋 프롬프트 복사</button>
        <button class="btn-ghost dl">⬇︎ 파일 내려받기</button>
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

    (root.querySelector(".share") as HTMLButtonElement).onclick = async () => {
      const r = await shareFiles(pkg.files, `독서 캡처 — ${title}`);
      if (r === "shared") {
        await markExported(caps);
        flash("공유했어요");
      } else if (r === "cancelled") {
        /* 사용자가 닫음 — 조용히 */
      } else if (r === "unsupported") {
        flash("이 기기는 파일 공유 미지원 — 복사/다운로드를 쓰세요");
      } else {
        flash("공유 중 문제가 생겼어요");
      }
    };

    (root.querySelector(".copy") as HTMLButtonElement).onclick = async () => {
      flash((await copyText(pkg.promptMd)) ? "프롬프트를 복사했어요" : "복사에 실패했어요");
    };

    (root.querySelector(".dl") as HTMLButtonElement).onclick = () => {
      pkg.files.forEach(downloadFile);
      flash(`${pkg.files.length}개 파일을 내려받아요`);
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
