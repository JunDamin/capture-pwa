/** Home — 지금 읽는 책(이어읽기) + 최근 세션 + 독서 시작. PRD §8-A, 토스 라이트. */
import type { Nav } from "../app.ts";
import { openSession, recentSessions, startNewSession, type SessionView } from "../db/db.ts";

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
    const [open, recent] = await Promise.all([openSession(), recentSessions(8)]);
    render(open, recent);
  })();

  function render(open: SessionView | null, recent: SessionView[]) {
    const top = open
      ? topCard(open, "이어 읽기", true)
      : recent[0]
        ? topCard(recent[0], "다시 읽기", false)
        : emptyCard();

    const rest = recent.filter((r) => !open || r.session.uuid !== open.session.uuid);

    root.innerHTML = `
    <div class="scr scr--light home">
      <h1 class="home__h">지금 읽는 책</h1>
      ${top}
      <button class="btn-primary home__start">${open ? "+ 다른 책으로 시작" : "▶ 독서 시작"}</button>
      ${
        rest.length
          ? `<div class="sectit">최근 세션</div>
             <div class="recent">${rest.map(recentItem).join("")}</div>`
          : ""
      }
      <button class="home__transfer">백업·가져오기</button>
    </div>`;

    const startBtn = root.querySelector(".home__start") as HTMLButtonElement;
    startBtn.onclick = () => nav({ name: "books" });

    (root.querySelector(".home__transfer") as HTMLButtonElement).onclick = () =>
      nav({ name: "transfer" });

    const topEl = root.querySelector(".bookcard[data-action]") as HTMLElement | null;
    if (topEl) topEl.onclick = () => handleSessionTap(topEl.dataset.id!, topEl.dataset.open === "1");
    if (!open && !recent.length) {
      (root.querySelector(".emptycard") as HTMLElement).onclick = () => nav({ name: "books" });
    }

    root.querySelectorAll<HTMLElement>(".recent .item").forEach((el) => {
      el.onclick = () => handleSessionTap(el.dataset.id!, el.dataset.open === "1");
    });

    root.querySelectorAll<HTMLElement>(".card-modes .cm-btn").forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const card = btn.closest("[data-id]") as HTMLElement;
        const sessionId = card.dataset.id!;
        const bookId = card.dataset.book!;
        const isOpen = card.dataset.open === "1";
        const mode = btn.dataset.mode as "photo" | "input";
        const id = isOpen ? sessionId : await startNewSession(bookId);
        nav({ name: "capture", sessionId: id, mode });
      };
    });
  }

  function handleSessionTap(sessionId: string, _isOpen: boolean) {
    nav({ name: "review", scope: "session", id: sessionId });
  }

  function topCard(v: SessionView, _cta: string, isOpen: boolean) {
    return `
    <div class="bookcard" data-action data-id="${v.session.uuid}" data-open="${isOpen ? 1 : 0}" data-book="${v.session.bookId}">
      <div class="bookcard__row">
        <div class="cover cov-1">${esc(v.bookTitle).slice(0, 6)}</div>
        <div class="bookcard__body">
          <div class="booktitle">${esc(v.bookTitle)}</div>
          ${v.session.project ? `<div class="bookmeta">🎯 ${esc(v.session.project)}</div>` : ""}
          <div class="sessionchip">
            <span class="dot ${isOpen ? "" : "dot--off"}"></span>
            ${isOpen ? "현재 세션" : relTime(v.lastActivity)} · ${v.count} Captures
          </div>
        </div>
        <div class="chev">›</div>
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

  function recentItem(v: SessionView, i: number) {
    return `
    <div class="item" data-id="${v.session.uuid}" data-open="${v.session.ended == null ? 1 : 0}" data-book="${v.session.bookId}">
      <div class="item__row">
        <div class="mini ${coverClass(i)}"></div>
        <div class="item__body">
          <div class="item__t">${esc(v.bookTitle)}</div>
          <div class="item__s">${v.count} captures${v.session.project ? " · " + esc(v.session.project) : ""}</div>
        </div>
        <div class="item__when">${v.session.ended == null ? "진행 중" : relTime(v.lastActivity)}</div>
      </div>
      <div class="card-modes">
        <button class="cm-btn cm-photo" data-mode="photo" aria-label="사진으로 캡처">📷 사진</button>
        <button class="cm-btn cm-input" data-mode="input" aria-label="입력으로 캡처">✍️ 입력</button>
      </div>
    </div>`;
  }

  return () => {};
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
