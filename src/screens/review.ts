/** Review — 규칙 기반 분류 + Export 진입. AI 호출 없음(ADR-007). PRD §8-C. */
import type { Nav, Scope } from "../app.ts";
import {
  capturesForBook,
  capturesForSession,
  deleteCapture,
  getBook,
  getSession,
  putSession,
} from "../db/db.ts";
import { TAGS, type Capture, type Session } from "../db/types.ts";

export function mountReview(root: HTMLElement, nav: Nav, scope: Scope, id: string): () => void {
  const urls: string[] = [];
  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;

  let bookId = "";
  let title = "";
  let session: Session | null = null;

  (async () => {
    let caps: Capture[];
    if (scope === "session") {
      const s = await getSession(id);
      if (!s) return nav({ name: "home" });
      session = s;
      bookId = s.bookId;
      const book = await getBook(s.bookId);
      title = book?.title ?? "(책)";
      caps = await capturesForSession(id);
    } else {
      bookId = id;
      const book = await getBook(id);
      title = book?.title ?? "(책)";
      caps = await capturesForBook(id);
    }
    render(caps);
  })();

  function render(caps: Capture[]) {
    // revoke previous batch before re-creating to prevent objectURL accumulation
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.length = 0;
    const scopeLabel = scope === "session" ? "이번 세션" : "이 책 전체";

    const tagRows = TAGS.map((t) => {
      const n = caps.filter((c) => c.tag === t.key).length;
      return n ? `<div class="srow"><span>${t.emoji} ${t.label}</span><b>${n}</b></div>` : "";
    }).join("");

    root.innerHTML = `
    <div class="scr scr--light review">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">${esc(title)}</div>
        ${scope === "session" ? `<button class="iconbtn review__editproj" aria-label="세션 목적 편집">✎</button>` : ""}
      </div>

      <div class="hero">
        <div class="hero__n">${caps.length}<span>개의 Capture</span></div>
        <div class="hero__scope">${scopeLabel}</div>
        ${
          scope === "session"
            ? `<button class="scopebtn toBook">이 책 전체 보기 ›</button>`
            : ""
        }
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
        <div class="caplist">${caps.map(card).join("")}</div>
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

    const editProj = root.querySelector(".review__editproj") as HTMLElement | null;
    if (editProj && session) {
      editProj.onclick = () => {
        const cur = session!.project ?? "";
        const next = prompt("왜 이 책을 읽나요?", cur);
        if (next === null) return;
        const project = next.trim() || undefined;
        session = { ...session!, project };
        putSession(session).then(() => render(caps)).catch((e) => console.error("putSession failed", e));
      };
    }

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
    return `<div class="hint-empty">아직 캡처가 없어요. 캡처 화면에서 첫 생각을 붙잡아 보세요.</div>`;
  }

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
