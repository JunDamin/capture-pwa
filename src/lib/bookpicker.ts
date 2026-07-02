/** 책 선택 바텀시트 — capture(책 전환)/detail(책 바꾸기) 공용. objectURL 자체 관리. */
import { recentBooks } from "../db/db.ts";
import type { Book } from "../db/types.ts";

export function openBookPicker(opts: {
  currentBookId?: string;
  onPick: (book: Book) => void | Promise<void>;
}): void {
  const urls: string[] = [];
  const el = document.createElement("div");
  el.className = "bookpick";
  el.innerHTML = `<div class="bookpick__card"><div class="bookpick__t">책 선택</div><div class="bookpick__list"><div class="loading">불러오는 중…</div></div></div>`;
  document.body.appendChild(el);
  const dismiss = () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.length = 0;
    el.remove();
  };
  el.onclick = (ev) => { if (ev.target === el) dismiss(); };

  (async () => {
    const views = await recentBooks(50);
    const list = el.querySelector(".bookpick__list") as HTMLElement;
    if (!list.isConnected) return; // 이미 dismiss됨
    if (!views.length) { list.innerHTML = `<div class="hint-empty">아직 책이 없어요 — 책장에서 먼저 등록해 주세요</div>`; return; }
    list.innerHTML = views.map((v, i) => {
      let coverHtml = `<div class="mini cov-${(i % 3) + 1}"></div>`;
      if (v.book.cover instanceof ArrayBuffer) {
        const u = URL.createObjectURL(new Blob([v.book.cover], { type: v.book.coverType ?? "image/jpeg" }));
        urls.push(u);
        coverHtml = `<img class="mini mini--img" src="${u}" alt="" />`;
      }
      const cur = v.book.uuid === opts.currentBookId;
      return `<button class="bookpick__row" data-i="${i}">
        ${coverHtml}
        <span class="bookpick__body"><span class="bookpick__title">${esc(v.book.title)}</span>
        <span class="bookpick__sub">캡처 ${v.captureCount}개</span></span>
        ${cur ? `<span class="bookpick__check">✓</span>` : ""}
      </button>`;
    }).join("");
    list.querySelectorAll<HTMLButtonElement>(".bookpick__row").forEach((row) => {
      row.onclick = async () => {
        const v = views[Number(row.dataset.i)];
        if (v.book.uuid === opts.currentBookId) { dismiss(); return; } // 같은 책 = no-op
        await opts.onPick(v.book); // 갱신 완료 후 닫기(레이스 방지)
        dismiss();
      };
    });
  })();
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
