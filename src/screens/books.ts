/** 책 선택 / 새 책 등록 → 세션 시작. PRD §8-A, ADR-005/006. */
import type { Nav } from "../app.ts";
import {
  endAllOpenSessions,
  listBooks,
  putBook,
  putSession,
  uuid,
} from "../db/db.ts";
import type { Book } from "../db/types.ts";

export function mountBooks(root: HTMLElement, nav: Nav): () => void {
  let books: Book[] = [];
  let chosen: Book | null = null; // 선택/생성된 책 → 프로젝트 단계

  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;
  (async () => {
    books = await listBooks();
    renderList();
  })();

  function renderList() {
    root.innerHTML = `
    <div class="scr scr--light books">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">독서 시작</div>
      </div>

      <div class="card form">
        <input class="field title" placeholder="책 제목" autocomplete="off" />
        <input class="field author" placeholder="저자 (선택)" autocomplete="off" />
        <button class="btn-primary add">새 책으로 시작</button>
      </div>

      ${
        books.length
          ? `<div class="sectit">내 책</div>
             <div class="recent">${books.map(bookRow).join("")}</div>`
          : `<div class="hint-empty">아직 등록한 책이 없어요. 위에서 새 책을 추가하세요.</div>`
      }
    </div>`;

    (root.querySelector(".back") as HTMLElement).onclick = () => nav({ name: "home" });

    const titleEl = root.querySelector(".title") as HTMLInputElement;
    const authorEl = root.querySelector(".author") as HTMLInputElement;
    const addBtn = root.querySelector(".add") as HTMLButtonElement;
    addBtn.onclick = async () => {
      const title = titleEl.value.trim();
      if (!title) {
        titleEl.focus();
        titleEl.classList.add("field--err");
        return;
      }
      const book: Book = { uuid: uuid(), title, author: authorEl.value.trim() || undefined };
      await putBook(book);
      chosen = book;
      renderProject();
    };
    titleEl.oninput = () => titleEl.classList.remove("field--err");

    root.querySelectorAll<HTMLElement>(".recent .item").forEach((el) => {
      el.onclick = () => {
        chosen = books.find((b) => b.uuid === el.dataset.id) ?? null;
        if (chosen) renderProject();
      };
    });
  }

  function renderProject() {
    root.innerHTML = `
    <div class="scr scr--light books">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">세션 시작</div>
      </div>

      <div class="card">
        <div class="proj__book">📚 ${esc(chosen!.title)}${
          chosen!.author ? ` <span class="proj__author">· ${esc(chosen!.author)}</span>` : ""
        }</div>
        <label class="proj__label">왜 이 책을 읽나요? <span class="opt">선택</span></label>
        <input class="field project" placeholder="예: 지방교육 프로젝트" autocomplete="off" />
        <div class="proj__hint">목적은 캡처 화면 상단에 계속 보이며, AI에게 맥락을 줍니다.</div>
        <button class="btn-primary start">세션 시작</button>
      </div>
    </div>`;

    (root.querySelector(".back") as HTMLElement).onclick = () => renderList();
    const projEl = root.querySelector(".project") as HTMLInputElement;
    projEl.focus();
    (root.querySelector(".start") as HTMLButtonElement).onclick = async () => {
      const now = Date.now();
      await endAllOpenSessions(now); // 다른 책으로 시작 시 이전 세션 종료(ADR-005)
      const session = {
        uuid: uuid(),
        bookId: chosen!.uuid,
        project: projEl.value.trim() || undefined,
        started: now,
        ended: null,
      };
      await putSession(session);
      nav({ name: "capture", sessionId: session.uuid });
    };
  }

  return () => {};
}

function bookRow(b: Book) {
  return `
  <div class="item" data-id="${b.uuid}">
    <div class="mini cov-1"></div>
    <div class="item__body">
      <div class="item__t">${esc(b.title)}</div>
      ${b.author ? `<div class="item__s">${esc(b.author)}</div>` : ""}
    </div>
    <div class="chev">›</div>
  </div>`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
