/** Review — 규칙 기반 분류 + Export 진입. AI 호출 없음(ADR-007). PRD §8-C. */
import type { Nav, Scope } from "../app.ts";
import {
  capturesForSession,
  capturesWithRoundsForBook,
  currentRoundFor,
  deleteCapture,
  deleteSession,
  displayRoundNo,
  getBook,
  getSession,
  putSession,
  sessionsForBook,
  startNewSession,
} from "../db/db.ts";
import { TAGS, type Capture, type Session } from "../db/types.ts";

export function mountReview(root: HTMLElement, nav: Nav, scope: Scope, id: string): () => void {
  const urls: string[] = [];
  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;

  let bookId = "";
  let title = "";
  let session: Session | null = null;
  let currentRound: Session | null = null;
  let currentRoundNo = 0;
  let groups: { roundNumber: number; session: Session; captures: Capture[] }[] = [];

  async function load() {
    let caps: Capture[];
    if (scope === "session") {
      const s = await getSession(id);
      if (!s) return nav({ name: "home" });
      session = s;
      bookId = s.bookId;
      const book = await getBook(s.bookId);
      title = book?.title ?? "(책)";
      const ss = await sessionsForBook(s.bookId);
      currentRound = s;
      currentRoundNo = displayRoundNo(ss, s);
      caps = await capturesForSession(id);
    } else {
      bookId = id;
      const book = await getBook(id);
      title = book?.title ?? "(책)";
      const ss = await sessionsForBook(id);
      currentRound = ss.filter((s) => s.ended == null).sort((a, b) => b.started - a.started)[0] ?? null;
      const latest = [...ss].sort((a, b) => b.started - a.started)[0];
      currentRoundNo = currentRound
        ? displayRoundNo(ss, currentRound)
        : latest
          ? displayRoundNo(ss, latest)
          : 0;
      groups = await capturesWithRoundsForBook(id);
      caps = groups.flatMap((g) => g.captures);
    }
    render(caps);
  }
  load();

  function render(caps: Capture[]) {
    // revoke previous batch before re-creating to prevent objectURL accumulation
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.length = 0;
    const scopeLabel = scope === "session" ? "이번 회독" : "이 책 전체";
    const roundBadge =
      currentRoundNo > 0
        ? `${currentRoundNo}회독${currentRound?.project ? " · " + esc(currentRound.project) : ""}`
        : "캡처 전";

    const tagRows = TAGS.map((t) => {
      const n = caps.filter((c) => c.tag === t.key).length;
      return n ? `<div class="srow"><span>${t.emoji} ${t.label}</span><b>${n}</b></div>` : "";
    }).join("");

    const listHtml =
      scope === "book"
        ? groups
            .map(
              (g) =>
                `<div class="roundsep">— ${g.roundNumber}회독${
                  g.session.project ? " · " + esc(g.session.project) : ""
                } —</div>` + g.captures.map(card).join(""),
            )
            .join("")
        : caps.map(card).join("");

    root.innerHTML = `
    <div class="scr scr--light review">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">${esc(title)}</div>
        ${currentRound ? `<button class="iconbtn review__editproj" aria-label="회독 목적 편집">✎</button>` : ""}
      </div>

      <div class="hero">
        <div class="hero__n">${caps.length}<span>개의 Capture</span></div>
        <div class="hero__scope">${scopeLabel}</div>
        ${scope === "book" ? `<div class="hero__round">${roundBadge}</div>` : ""}
        ${
          scope === "session"
            ? `<button class="scopebtn toBook">이 책 전체 보기 ›</button>
        <button class="scopebtn toBookExport">📤 이 책 전체 AI 전달</button>`
            : `<button class="scopebtn newround">새 회독 시작</button>`
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
      ${scope === "session" ? `<button class="danger-link sessiondel">이 회독 삭제</button>` : ""}
    </div>`;

    (root.querySelector(".back") as HTMLElement).onclick = () => nav({ name: "home" });
    const toBook = root.querySelector(".toBook") as HTMLElement | null;
    if (toBook) toBook.onclick = () => nav({ name: "review", scope: "book", id: bookId });
    const exportBtn = root.querySelector(".export") as HTMLElement | null;
    if (exportBtn) exportBtn.onclick = () => nav({ name: "export", scope, id });

    const beEl = root.querySelector(".toBookExport") as HTMLButtonElement | null;
    if (beEl) beEl.onclick = () => nav({ name: "export", scope: "book", id: bookId });

    const nrEl = root.querySelector(".newround") as HTMLButtonElement | null;
    if (nrEl) nrEl.onclick = async () => {
      await startNewSession(bookId);
      await load();
    };

    const sdEl = root.querySelector(".sessiondel") as HTMLButtonElement | null;
    if (sdEl) sdEl.onclick = async () => {
      const n = caps.length;
      if (!confirm(`이 회독의 캡처 ${n}개가 모두 지워집니다. 삭제할까요?`)) return;
      await deleteSession(id);
      nav({ name: "home" });
    };

    const editProj = root.querySelector(".review__editproj") as HTMLElement | null;
    if (editProj && currentRound) {
      editProj.onclick = () => {
        let changed = false;
        // 회독 번호 — 취소(null)하면 번호 유지, 제목 편집은 계속
        const noStr = prompt("회독 번호", String(currentRoundNo || 1));
        if (noStr !== null) {
          const n = parseInt(noStr, 10);
          if (Number.isFinite(n) && n >= 1 && n !== currentRoundNo) {
            currentRound = { ...currentRound!, roundNo: n };
            currentRoundNo = n;
            changed = true;
          }
        }
        const cur = currentRound!.project ?? "";
        const next = prompt("왜 이 책을 읽나요?", cur);
        if (next !== null) {
          const project = next.trim() || undefined;
          if (project !== currentRound!.project) {
            currentRound = { ...currentRound!, project };
            changed = true;
          }
        }
        if (!changed) return;
        if (session && session.uuid === currentRound!.uuid) session = currentRound;
        groups = groups.map((g) =>
          g.session.uuid === currentRound!.uuid
            ? { ...g, session: currentRound!, roundNumber: currentRound!.roundNo ?? g.roundNumber }
            : g,
        );
        putSession(currentRound!).then(() => render(caps)).catch((e) => console.error("putSession failed", e));
      };
    }

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
        groups = groups
          .map((g) => ({ ...g, captures: g.captures.filter((x) => x.uuid !== c.uuid) }))
          .filter((g) => g.captures.length > 0);
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
