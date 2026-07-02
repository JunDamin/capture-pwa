/** Review — 규칙 기반 분류 + Export 진입. AI 호출 없음(ADR-007). PRD §8-C. */
import type { Nav, Scope } from "../app.ts";
import {
  capturesForBook,
  capturesForSession,
  currentRoundFor,
  deleteCapture,
  getBook,
  getSession,
} from "../db/db.ts";
import { TAGS, type Book, type Capture } from "../db/types.ts";

export function mountReview(root: HTMLElement, nav: Nav, scope: Scope, id: string): () => void {
  const urls: string[] = [];
  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;

  let bookId = "";
  let title = "";
  let book: Book | null = null;

  async function load() {
    let caps: Capture[];
    if (scope === "session") {
      const s = await getSession(id);
      if (!s) return nav({ name: "home" });
      bookId = s.bookId;
      book = (await getBook(s.bookId)) ?? null;
      title = book?.title ?? "(책)";
      caps = await capturesForSession(id);
    } else {
      bookId = id;
      book = (await getBook(id)) ?? null;
      title = book?.title ?? "(책)";
      caps = await capturesForBook(id);
    }
    render(caps);
  }
  load();

  function render(caps: Capture[]) {
    // revoke previous batch before re-creating to prevent objectURL accumulation
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.length = 0;
    const scopeLabel = scope === "session" ? "최근 기록" : "이 책 전체";

    const tagRows = TAGS.map((t) => {
      const n = caps.filter((c) => c.tag === t.key).length;
      return n ? `<div class="srow"><span>${t.emoji} ${t.label}</span><b>${n}</b></div>` : "";
    }).join("");

    let heroCover = "";
    if (book?.cover instanceof ArrayBuffer) {
      const u = URL.createObjectURL(new Blob([book.cover], { type: book.coverType ?? "image/jpeg" }));
      urls.push(u);
      heroCover = `<img class="hero__cover" src="${u}" alt="" />`;
    }

    // 날짜 구분선 — 직전 캡처와 로컬 달력 날짜가 다르면 삽입(createdAt asc)
    let prevDay = "";
    const listHtml = caps
      .map((c) => {
        const day = new Date(c.createdAt).toDateString();
        const sep = day !== prevDay ? `<div class="datesep">${dateLabel(c.createdAt)}</div>` : "";
        prevDay = day;
        return sep + card(c);
      })
      .join("");

    root.innerHTML = `
    <div class="scr scr--light review">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">${esc(title)}</div>
      </div>

      <div class="hero">
        <div class="hero__head">
          ${heroCover}
          <div>
            <div class="hero__n">${caps.length}<span>개의 Capture</span></div>
            <div class="hero__scope">${scopeLabel}</div>
          </div>
        </div>
        ${
          scope === "session"
            ? `<button class="scopebtn toBook">이 책 전체 보기 ›</button>
        <button class="scopebtn toBookExport">📤 이 책 전체 AI 전달</button>`
            : ""
        }
      </div>

      <div class="card-modes">
        <button class="cm-btn" data-mode="photo">📷 사진</button>
        <button class="cm-btn" data-mode="input">✍️ 입력</button>
      </div>

      ${caps.length === 0 ? emptyState() : ""}

      ${
        caps.length
          ? `
      <div class="card">
        <div class="card__h">태그</div>
        ${tagRows || `<div class="srow muted">태그 없음</div>`}
      </div>

      <div class="card card--list">
        <div class="card__h">캡처 ${caps.length}</div>
        <div class="caplist">${listHtml}</div>
      </div>

      <button class="btn-primary export">📤 Export — AI에게 넘기기</button>
      `
          : ""
      }
    </div>`;

    (root.querySelector(".back") as HTMLElement).onclick = () => nav({ name: "home" });
    const toBook = root.querySelector(".toBook") as HTMLElement | null;
    if (toBook) toBook.onclick = () => nav({ name: "review", scope: "book", id: bookId });
    const exportBtn = root.querySelector(".export") as HTMLElement | null;
    if (exportBtn) exportBtn.onclick = () => nav({ name: "export", scope, id });

    const beEl = root.querySelector(".toBookExport") as HTMLButtonElement | null;
    if (beEl) beEl.onclick = () => nav({ name: "export", scope: "book", id: bookId });

    // 캡처 시작 버튼 — 스코프 공통, 항상 현재 회독으로(get-or-create)
    root.querySelectorAll<HTMLElement>(".card-modes .cm-btn").forEach((btn) => {
      btn.onclick = async () => {
        const mode = btn.dataset.mode as "photo" | "input";
        const sid = await currentRoundFor(bookId);
        nav({ name: "capture", sessionId: sid, mode });
      };
    });

    // 썸네일 주입 + 삭제
    caps.forEach((c) => {
      const el = root.querySelector(`.capcard[data-id="${c.uuid}"]`) as HTMLElement | null;
      if (!el) return;
      if (c.image) {
        const u = URL.createObjectURL(c.image);
        urls.push(u);
        (el.querySelector(".capthumb") as HTMLElement).style.backgroundImage = `url(${u})`;
      }
      el.onclick = () => nav({ name: "detail", captureId: c.uuid, from: { scope, id } });
      (el.querySelector(".capdel") as HTMLElement).onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm("이 캡처를 삭제할까요?")) return;
        await deleteCapture(c.uuid);
        const next = caps.filter((x) => x.uuid !== c.uuid);
        render(next);
      };
    });
  }

  function dateLabel(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const y = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}년 ` : "";
    return `— ${y}${d.getMonth() + 1}월 ${d.getDate()}일 —`;
  }

  function card(c: Capture) {
    const tag = TAGS.find((t) => t.key === c.tag)!;
    const t = new Date(c.createdAt);
    const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    return `
    <div class="capcard" data-id="${c.uuid}">
      <div class="capthumb ${c.image ? "" : "capthumb--none"}">${c.image ? "" : "📝"}</div>
      <div class="capbody">
        <div class="capmeta"><span class="captag">${tag.emoji} ${tag.label}</span> ${esc(c.passage ?? c.memo ?? c.why ?? "—")}</div>
        <div class="captime">${hm}</div>
      </div>
      <button class="capdel" aria-label="삭제">🗑</button>
    </div>`;
  }

  function emptyState() {
    if (scope === "session") {
      return `<div class="hint-empty">
        <p>아직 캡처가 없어요. 첫 생각을 붙잡아 보세요.</p>
      </div>`;
    }
    return `<div class="hint-empty">아직 캡처가 없어요. 캡처 화면에서 첫 생각을 붙잡아 보세요.</div>`;
  }

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
