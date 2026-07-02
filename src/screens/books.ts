/** 책장 — 책 목록·새 책 등록(등록 직후 첫 회독 시작). PRD §8-A, ADR-005/006/016. */
import type { Nav } from "../app.ts";
import {
  capturesForBook,
  currentRoundFor,
  deleteBook,
  listBooks,
  putBook,
  startNewSession,
  uuid,
} from "../db/db.ts";
import type { Book } from "../db/types.ts";
import { type AladinItem, fetchCover, getTtbKey, searchBooks } from "../lib/aladin.ts";
import { hasPendingSharedText } from "../lib/install.ts";

export function mountBooks(root: HTMLElement, nav: Nav): () => void {
  let books: Book[] = [];
  let chosen: Book | null = null; // 선택/생성된 책 → 프로젝트 단계
  const urls: string[] = []; // 표지 objectURL — 재렌더/이탈 시 revoke

  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;
  (async () => {
    books = await listBooks();
    renderList();
  })();

  function renderList() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.length = 0;
    root.innerHTML = `
    <div class="scr scr--light books">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">책장</div>
      </div>

      <div class="card form">
        <input class="field title" placeholder="책 제목" autocomplete="off" />
        <input class="field author" placeholder="저자 (선택)" autocomplete="off" />
        <button class="btn-primary add">새 책으로 시작</button>
      </div>

      ${
        books.length
          ? `<div class="sectit">내 책</div>
             <div class="recent">${books.map((b) => bookRow(b, urls)).join("")}</div>`
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

    // 행 탭 = 책 Review
    root.querySelectorAll<HTMLElement>(".recent .item").forEach((el) => {
      el.onclick = () => nav({ name: "review", scope: "book", id: el.dataset.id! });
    });

    // 📷/✍️ = 현재 회독에 캡처(get-or-create)
    root.querySelectorAll<HTMLElement>(".card-modes .cm-btn").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const row = btn.closest(".item") as HTMLElement;
        const sid = await currentRoundFor(row.dataset.id!);
        nav({ name: "capture", sessionId: sid, mode: btn.dataset.mode as "photo" | "input" });
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
        if (!confirm(`'${b?.title ?? "이 책"}'과 이 책의 모든 회독·캡처 ${caps.length}개가 지워집니다. 삭제할까요?`)) return;
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
        <div class="topbar__t">회독 시작</div>
      </div>

      <div class="card">
        <div class="proj__book">📚 ${esc(chosen!.title)}${
          chosen!.author ? ` <span class="proj__author">· ${esc(chosen!.author)}</span>` : ""
        }</div>
        <label class="proj__label">왜 이 책을 읽나요? <span class="opt">선택</span></label>
        <input class="field project" placeholder="회독 제목 (선택)" autocomplete="off" />
        <div class="proj__hint">목적은 캡처 화면 상단에 계속 보이며, AI에게 맥락을 줍니다.</div>
        <label class="proj__label">시작 모드</label>
        <div class="mode-toggle mode-toggle--light proj__modesel">
          <button class="mode-btn mode-btn--photo${selectedMode === "photo" ? " is-active" : ""}" aria-label="사진 모드">📷 사진</button>
          <button class="mode-btn mode-btn--input${selectedMode === "input" ? " is-active" : ""}" aria-label="입력 모드">✍️ 입력</button>
        </div>
        <button class="btn-primary start">회독 시작</button>
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
        ${getTtbKey() ? `<button class="btn-ghost coverfind">표지 찾기</button><div class="coverres"></div>` : ""}
        <button class="btn-primary save">저장</button>
      </div>

      <div class="toast" hidden></div>
    </div>`;

    const flash = (msg: string) => {
      const toast = root.querySelector(".toast") as HTMLElement | null;
      if (!toast) return; // 화면 이탈 후 늦은 응답 — 무시
      toast.textContent = msg;
      toast.hidden = false;
      setTimeout(() => (toast.hidden = true), 2400);
    };

    (root.querySelector(".back") as HTMLElement).onclick = () => renderList();
    const titleEl = root.querySelector(".e-title") as HTMLInputElement;
    const authorEl = root.querySelector(".e-author") as HTMLInputElement;
    const isbnEl = root.querySelector(".e-isbn") as HTMLInputElement;
    titleEl.oninput = () => titleEl.classList.remove("field--err");

    const findBtn = root.querySelector(".coverfind") as HTMLButtonElement | null;
    if (findBtn)
      findBtn.onclick = async () => {
        const q = titleEl.value.trim() || book.title;
        findBtn.disabled = true;
        findBtn.textContent = "검색 중…";
        try {
          const items = await searchBooks(q);
          renderCoverResults(items);
        } catch (e) {
          flash(String(e).includes("aladin:") ? "키를 확인해주세요" : "표지를 찾지 못했어요");
        } finally {
          findBtn.disabled = false;
          findBtn.textContent = "표지 찾기";
        }
      };

    function renderCoverResults(items: AladinItem[]) {
      const box = root.querySelector(".coverres") as HTMLElement | null;
      if (!box) return; // 화면 이탈 후 늦은 응답 — 무시
      if (!items.length) {
        box.innerHTML = `<div class="hint-empty">결과가 없어요</div>`;
        return;
      }
      box.innerHTML = items
        .map(
          (it, i) => `
        <button class="coveropt" data-i="${i}">
          <img src="${esc(it.cover)}" alt="" loading="lazy" />
          <span class="coveropt__t">${esc(it.title)}</span>
          <span class="coveropt__a">${esc(it.author)}</span>
        </button>`,
        )
        .join("");
      box.querySelectorAll<HTMLButtonElement>(".coveropt").forEach((el) => {
        el.onclick = async () => {
          const it = items[Number(el.dataset.i)];
          try {
            const { buf, type } = await fetchCover(it.cover);
            // ISBN 자동 채움: 라이브 폼 필드 기준(레이스 방지), isbn13 빈값 스킵
            const fillIsbn = !isbnEl.value.trim() && it.isbn13 ? it.isbn13 : null;
            if (fillIsbn) isbnEl.value = fillIsbn;
            await putBook({ ...book, cover: buf, coverType: type, ...(fillIsbn ? { isbn: fillIsbn } : {}) });
            book.cover = buf;
            book.coverType = type;
            if (fillIsbn) book.isbn = fillIsbn;
            flash("표지를 저장했어요");
            const resBox = root.querySelector(".coverres") as HTMLElement | null;
            if (resBox) resBox.innerHTML = "";
          } catch {
            flash("표지를 가져오지 못했어요"); // 결과 유지 — 재시도
          }
        };
      });
    }
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

  return () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}

function bookRow(b: Book, urls: string[]) {
  let mini = `<div class="mini cov-1"></div>`;
  if (b.cover instanceof ArrayBuffer) {
    const u = URL.createObjectURL(new Blob([b.cover], { type: b.coverType ?? "image/jpeg" }));
    urls.push(u);
    mini = `<img class="mini mini--img" src="${u}" alt="" />`;
  }
  return `
  <div class="item" data-id="${b.uuid}">
    <div class="item__row">
      ${mini}
      <div class="item__body">
        <div class="item__t">${esc(b.title)}</div>
        ${b.author ? `<div class="item__s">${esc(b.author)}</div>` : ""}
      </div>
      <button class="bookrow__edit" data-edit="${b.uuid}" aria-label="책 편집">✎</button>
      <button class="bookrow__del" data-del="${b.uuid}" aria-label="책 삭제">🗑</button>
      <div class="chev">›</div>
    </div>
    <div class="card-modes">
      <button class="cm-btn cm-photo" data-mode="photo" aria-label="사진으로 캡처">📷 사진</button>
      <button class="cm-btn cm-input" data-mode="input" aria-label="입력으로 캡처">✍️ 입력</button>
    </div>
  </div>`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
