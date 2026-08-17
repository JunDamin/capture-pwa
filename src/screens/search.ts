/**
 * 전역 검색 — 책(제목·저자) + 캡처 본문. 결과는 책별로 묶는다. ADR-022.
 *
 * 이미지는 절대 싣지 않는다: 캡처 조회는 `searchCaptures`(이미지 비적재 계약)만 쓰고,
 * 이 화면이 만드는 objectURL은 책 표지뿐이다. 타이핑마다 재렌더되므로 revoke를 놓치면
 * 다른 화면보다 빠르게 샌다.
 */
import type { Nav } from "../app.ts";
import { escapeHtml as esc, formatTime } from "../lib/ui.ts";
import { allSessions, listBooks, searchCaptures, type CaptureHit } from "../db/db.ts";
import { TAGS, type Book } from "../db/types.ts";

const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;

interface BookGroup {
  book: Book;
  hits: CaptureHit[];
  titleMatch: boolean;
  lastActivity: number;
}

export function mountSearch(root: HTMLElement, nav: Nav, initialQ: string): () => void {
  let urls: string[] = []; // 표지 objectURL — 재렌더/이탈 시 revoke
  let timer: number | null = null;
  let composing = false; // 한글 조합 중에는 검색하지 않는다(자모마다 input이 발화)
  let seq = 0; // 늦게 도착한 검색 결과 폐기용

  root.innerHTML = template(initialQ);

  const input = root.querySelector(".search__input") as HTMLInputElement;
  const results = root.querySelector(".search__results") as HTMLElement;

  (root.querySelector(".back") as HTMLElement).onclick = () => nav({ name: "home" });

  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    schedule();
  });
  input.oninput = () => {
    if (composing) return; // 조합이 끝나면 compositionend가 한 번 돌린다
    schedule();
  };

  function schedule() {
    if (timer != null) clearTimeout(timer);
    timer = window.setTimeout(() => void run(input.value), DEBOUNCE_MS);
  }

  async function run(q: string) {
    const mine = ++seq;
    const query = q.trim();
    if (query.length < MIN_QUERY) {
      if (mine === seq) renderEmptyPrompt();
      return;
    }
    const [found, books, sessions] = await Promise.all([
      searchCaptures(query),
      listBooks(),
      allSessions(),
    ]);
    if (mine !== seq) return; // 더 최근 검색이 이미 돌았다
    render(query, found.hits, found.truncated, books, sessions);
  }

  function clearUrls() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
  }

  function renderEmptyPrompt() {
    clearUrls();
    results.innerHTML = `<div class="search__empty">두 글자 이상 입력하면 찾아드려요</div>`;
  }

  function render(
    query: string,
    hits: CaptureHit[],
    truncated: boolean,
    books: Book[],
    sessions: { uuid: string; bookId: string; started: number; lastCaptureAt?: number }[],
  ) {
    clearUrls();

    // 세션 → 책, 그리고 책별 최근 활동(recentBooks를 부르지 않는다 — 책마다 countCaptures를 돌아 과하다)
    const bookOf = new Map<string, string>();
    const activity = new Map<string, number>();
    for (const s of sessions) {
      bookOf.set(s.uuid, s.bookId);
      const at = Math.max(s.started, s.lastCaptureAt ?? 0);
      activity.set(s.bookId, Math.max(activity.get(s.bookId) ?? 0, at));
    }

    const needle = query.toLowerCase();
    const groups = new Map<string, BookGroup>();
    const groupFor = (book: Book): BookGroup => {
      let g = groups.get(book.uuid);
      if (!g) {
        g = { book, hits: [], titleMatch: false, lastActivity: activity.get(book.uuid) ?? 0 };
        groups.set(book.uuid, g);
      }
      return g;
    };

    // 제목·저자 매치는 캡처 매치가 없어도 헤더로 노출한다
    for (const b of books) {
      if (`${b.title} ${b.author ?? ""}`.toLowerCase().includes(needle)) {
        groupFor(b).titleMatch = true;
      }
    }
    const byId = new Map(books.map((b) => [b.uuid, b]));
    for (const h of hits) {
      const bookId = bookOf.get(h.sessionId);
      const book = bookId ? byId.get(bookId) : undefined;
      if (!book) continue; // 책이 지워진 고아 캡처 — 조용히 건너뛴다
      groupFor(book).hits.push(h);
    }

    const ordered = [...groups.values()].sort(
      (a, b) => b.hits.length - a.hits.length || b.lastActivity - a.lastActivity,
    );

    if (!ordered.length) {
      results.innerHTML = `<div class="search__empty">찾는 내용이 없어요</div>`;
      return;
    }

    results.innerHTML =
      ordered.map((g) => groupHtml(g, query, urls)).join("") +
      (truncated
        ? `<div class="search__more">결과가 많아 200개까지만 보여줘요 — 검색어를 더 좁혀보세요</div>`
        : "");

    results.querySelectorAll<HTMLElement>(".sgroup__t").forEach((el) => {
      el.onclick = () => nav({ name: "review", scope: "book", id: el.dataset.book! });
    });
    results.querySelectorAll<HTMLElement>(".shit").forEach((el) => {
      el.onclick = () =>
        nav({ name: "detail", captureId: el.dataset.id!, from: { scope: "search", q: query } });
    });
  }

  // 진입 시 즉시 1회 — 상세에서 뒤로 왔을 때 결과가 그대로 복원되어야 한다
  void run(initialQ);
  input.focus();

  return () => {
    if (timer != null) clearTimeout(timer);
    seq += 1; // 진행 중 검색 결과 무효화
    clearUrls();
  };
}

/** 매치 부분만 <mark>. esc 이후에 넣어야 XSS가 생기지 않는다. */
function highlight(text: string, query: string): string {
  const safe = esc(text);
  const at = safe.toLowerCase().indexOf(esc(query).toLowerCase());
  if (at < 0) return safe;
  const end = at + esc(query).length;
  return `${safe.slice(0, at)}<mark>${safe.slice(at, end)}</mark>${safe.slice(end)}`;
}

function coverHtml(b: Book, urls: string[]): string {
  if (b.cover instanceof ArrayBuffer) {
    const u = URL.createObjectURL(new Blob([b.cover], { type: b.coverType ?? "image/jpeg" }));
    urls.push(u);
    return `<img class="mini mini--img" src="${u}" alt="" />`;
  }
  return `<div class="mini cov-1"></div>`;
}

function groupHtml(g: BookGroup, query: string, urls: string[]): string {
  const count = g.hits.length
    ? `<span class="sgroup__n">캡처 ${g.hits.length}</span>`
    : `<span class="sgroup__n">제목 일치</span>`;
  return `
  <div class="sgroup">
    <button class="sgroup__t" data-book="${g.book.uuid}">
      ${coverHtml(g.book, urls)}
      <span class="sgroup__body">
        <span class="sgroup__title">${highlight(g.book.title, query)}</span>
        ${g.book.author ? `<span class="sgroup__author">${highlight(g.book.author, query)}</span>` : ""}
      </span>
      ${count}
      <span class="chev">›</span>
    </button>
    ${g.hits.map((h) => hitHtml(h, query)).join("")}
  </div>`;
}

function hitHtml(h: CaptureHit, query: string): string {
  const tag = TAGS.find((t) => t.key === h.tag)!;
  return `
  <div class="shit" data-id="${h.uuid}">
    <div class="shit__meta">
      <span class="captag">${tag.emoji} ${tag.label}</span>
      <span class="shit__where">${h.field === "passage" ? "담은 글" : "내 생각"}</span>
      <span class="shit__time">${formatTime(h.createdAt, "hm")}</span>
    </div>
    <div class="shit__snippet">${highlight(h.snippet, query)}</div>
  </div>`;
}

function template(q: string) {
  return `
  <div class="scr scr--light search">
    <div class="topbar">
      <button class="iconbtn back" aria-label="뒤로">‹</button>
      <input class="field search__input" value="${esc(q)}" placeholder="책·캡처 검색"
             autocomplete="off" autocorrect="off" enterkeyhint="search" />
    </div>
    <div class="search__results"></div>
  </div>`;
}
