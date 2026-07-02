/** 책 선택 / 새 책 등록 → 세션 시작. PRD §8-A, ADR-005/006. */
import type { Nav } from "../app.ts";
import {
  capturesForBook,
  deleteBook,
  listBooks,
  putBook,
  startNewSession,
  uuid,
} from "../db/db.ts";
import type { Book } from "../db/types.ts";
import { hasPendingSharedText } from "../lib/install.ts";

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

    root.querySelectorAll<HTMLElement>(".bookrow__edit").forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const book = books.find((b) => b.uuid === el.dataset.edit) ?? null;
        if (book) renderEdit(book);
      };
    });

    root.querySelectorAll<HTMLElement>(".bookrow__del").forEach((el) => {
      el.onclick = async (ev) => {
        ev.stopPropagation();
        const id = el.dataset.del!;
        const b = books.find((x) => x.uuid === id);
        const caps = await capturesForBook(id);
        if (!confirm(`'${b?.title ?? "이 책"}'과 이 책의 모든 세션·캡처 ${caps.length}개가 지워집니다. 삭제할까요?`)) return;
        await deleteBook(id);
        books = await listBooks();
        renderList();
      };
    });
  }

  function renderProject() {
    let selectedMode: "photo" | "input" = hasPendingSharedText() ? "input" : "photo";
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
        <label class="proj__label">시작 모드</label>
        <div class="mode-toggle mode-toggle--light proj__modesel">
          <button class="mode-btn mode-btn--photo${selectedMode === "photo" ? " is-active" : ""}" aria-label="사진 모드">📷 사진</button>
          <button class="mode-btn mode-btn--input${selectedMode === "input" ? " is-active" : ""}" aria-label="입력 모드">✍️ 입력</button>
        </div>
        <button class="btn-primary start">세션 시작</button>
      </div>
    </div>`;

    (root.querySelector(".back") as HTMLElement).onclick = () => renderList();
    const projEl = root.querySelector(".project") as HTMLInputElement;
    projEl.focus();
    const modeBtnPhoto = root.querySelector(".mode-btn--photo") as HTMLButtonElement;
    const modeBtnInput = root.querySelector(".mode-btn--input") as HTMLButtonElement;
    modeBtnPhoto.onclick = () => {
      selectedMode = "photo";
      modeBtnPhoto.classList.add("is-active");
      modeBtnInput.classList.remove("is-active");
    };
    modeBtnInput.onclick = () => {
      selectedMode = "input";
      modeBtnInput.classList.add("is-active");
      modeBtnPhoto.classList.remove("is-active");
    };

    (root.querySelector(".start") as HTMLButtonElement).onclick = async () => {
      const sid = await startNewSession(chosen!.uuid, projEl.value.trim() || undefined);
      nav({ name: "capture", sessionId: sid, mode: selectedMode });
    };
  }

  function renderEdit(book: Book) {
    root.innerHTML = `
    <div class="scr scr--light books">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">책 편집</div>
      </div>

      <div class="card form">
        <input class="field e-title" placeholder="책 제목" autocomplete="off" value="${esc(book.title)}" />
        <input class="field e-author" placeholder="저자 (선택)" autocomplete="off" value="${esc(book.author ?? "")}" />
        <input class="field e-isbn" placeholder="ISBN (선택)" autocomplete="off" value="${esc(book.isbn ?? "")}" />
        <button class="btn-primary save">저장</button>
      </div>
    </div>`;

    (root.querySelector(".back") as HTMLElement).onclick = () => renderList();
    const titleEl = root.querySelector(".e-title") as HTMLInputElement;
    const authorEl = root.querySelector(".e-author") as HTMLInputElement;
    const isbnEl = root.querySelector(".e-isbn") as HTMLInputElement;
    titleEl.oninput = () => titleEl.classList.remove("field--err");
    (root.querySelector(".save") as HTMLButtonElement).onclick = async () => {
      const title = titleEl.value.trim();
      if (!title) {
        titleEl.focus();
        titleEl.classList.add("field--err");
        return;
      }
      await putBook({
        ...book,
        title,
        author: authorEl.value.trim() || undefined,
        isbn: isbnEl.value.trim() || undefined,
      });
      books = await listBooks();
      renderList();
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
    <button class="bookrow__edit" data-edit="${b.uuid}" aria-label="책 편집">✎</button>
    <button class="bookrow__del" data-del="${b.uuid}" aria-label="책 삭제">🗑</button>
    <div class="chev">›</div>
  </div>`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
