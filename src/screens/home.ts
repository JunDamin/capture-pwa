/** Home — 최근 책 목록(회독 배지). PRD §8-A, 토스 라이트. */
import type { Nav } from "../app.ts";
import { recentBooks, currentRoundFor, type BookView } from "../db/db.ts";
import { isStandalone, promptInstall } from "../lib/install.ts";

declare const __BUILD__: string; // vite define — 빌드 시각 스탬프

function relTime(ts: number): string {
  const days = Math.floor((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const coverClass = (i: number) => `cov-${(i % 3) + 1}`;

export function mountHome(root: HTMLElement, nav: Nav): () => void {
  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;

  (async () => {
    const books = await recentBooks(8);
    render(books);
  })();

  function render(books: BookView[]) {
    const top = books[0] ? topCard(books[0]) : emptyCard();
    const rest = books.slice(1);

    root.innerHTML = `
    <div class="scr scr--light home">
      <h1 class="home__h">내 책</h1>
      ${top}
      <button class="btn-primary home__start">▶ 독서 시작</button>
      ${rest.length ? `<div class="sectit">다른 책</div><div class="recent">${rest.map(bookItem).join("")}</div>` : ""}
      ${isStandalone() ? "" : `<button class="home__install">홈 화면에 등록</button>`}
      <button class="home__transfer">백업·설정</button>
      <div class="home__ver">build ${__BUILD__}</div>
    </div>`;

    const startBtn = root.querySelector(".home__start") as HTMLButtonElement;
    startBtn.onclick = () => nav({ name: "books" });

    (root.querySelector(".home__transfer") as HTMLButtonElement).onclick = () =>
      nav({ name: "transfer" });

    const installBtn = root.querySelector(".home__install") as HTMLButtonElement | null;
    if (installBtn) installBtn.onclick = async () => {
      const r = await promptInstall();
      if (r === "accepted") installBtn.remove();
      else if (r === "unavailable") showIosInstallSheet(root);
    };

    if (!books.length) {
      (root.querySelector(".emptycard") as HTMLElement).onclick = () => nav({ name: "books" });
    }

    // 본문 탭 = 책 Review
    root.querySelectorAll<HTMLElement>("[data-book]").forEach((el) => {
      if (!el.classList.contains("bookcard") && !el.classList.contains("item")) return;
      el.onclick = () => nav({ name: "review", scope: "book", id: el.dataset.book! });
    });

    // 📷/✍️ = 현재 회독에 캡처(get-or-create)
    root.querySelectorAll<HTMLElement>(".card-modes .cm-btn").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const card = btn.closest("[data-book]") as HTMLElement;
        const sid = await currentRoundFor(card.dataset.book!);
        nav({ name: "capture", sessionId: sid, mode: btn.dataset.mode as "photo" | "input" });
      };
    });
  }

  function roundLabel(v: BookView): string {
    if (!v.totalRounds) return "캡처 전";
    const t = v.currentRound?.project ? ` · ${esc(v.currentRound.project)}` : "";
    return `${v.roundNumber}회독${t}`;
  }

  function topCard(v: BookView) {
    return `
    <div class="bookcard" data-action data-book="${v.book.uuid}">
      <div class="bookcard__row">
        <div class="cover cov-1">${esc(v.book.title).slice(0, 6)}</div>
        <div class="bookcard__body">
          <div class="booktitle">${esc(v.book.title)}</div>
          <div class="sessionchip"><span class="dot"></span>${roundLabel(v)} · ${v.captureCount} Captures</div>
        </div>
        <div class="chev">›</div>
      </div>
      <div class="card-modes">
        <button class="cm-btn cm-photo" data-mode="photo" aria-label="사진으로 캡처">📷 사진</button>
        <button class="cm-btn cm-input" data-mode="input" aria-label="입력으로 캡처">✍️ 입력</button>
      </div>
    </div>`;
  }

  function bookItem(v: BookView, i: number) {
    return `
    <div class="item" data-book="${v.book.uuid}">
      <div class="item__row">
        <div class="mini ${coverClass(i)}"></div>
        <div class="item__body">
          <div class="item__t">${esc(v.book.title)}</div>
          <div class="item__s">${roundLabel(v)} · ${v.captureCount} captures</div>
        </div>
        <div class="item__when">${v.lastActivity ? relTime(v.lastActivity) : ""}</div>
      </div>
      <div class="card-modes">
        <button class="cm-btn cm-photo" data-mode="photo" aria-label="사진으로 캡처">📷 사진</button>
        <button class="cm-btn cm-input" data-mode="input" aria-label="입력으로 캡처">✍️ 입력</button>
      </div>
    </div>`;
  }

  function emptyCard() {
    return `
    <div class="emptycard">
      <div class="emptycard__emoji">📖</div>
      <div class="emptycard__t">첫 생각을 붙잡아 보세요</div>
      <div class="emptycard__s">책을 고르면 캡처가 시작됩니다</div>
    </div>`;
  }

  return () => {};
}

function showIosInstallSheet(root: HTMLElement) {
  const el = document.createElement("div");
  el.className = "install-sheet";
  el.innerHTML = `<div class="install-sheet__card">
    <div class="install-sheet__t">홈 화면에 추가</div>
    <div class="install-sheet__s">Safari 하단 공유 버튼을 누르고<br>'홈 화면에 추가'를 선택하세요</div>
    <button class="btn-primary install-sheet__ok">확인</button>
  </div>`;
  root.appendChild(el);
  (el.querySelector(".install-sheet__ok") as HTMLButtonElement).onclick = () => el.remove();
  el.onclick = (ev) => { if (ev.target === el) el.remove(); };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
