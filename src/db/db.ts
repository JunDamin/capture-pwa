/** IndexedDB 저장소 — PRD §12. 서버/로그인 없음. 이미지는 ArrayBuffer(ADR-015, ADR-003 개정). */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Book, Capture, Session, Tag } from "./types.ts";

// --- iOS IDB-Blob 버그 회피 (ADR-015) ---
// iOS Safari가 저장된 Blob을 나중에 읽지 못함(NotFoundError). ArrayBuffer는 안정적.
// 저장 경계에서만 변환 — 소비자는 계속 Blob을 받는다.

async function blobToBuf(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });
}

// 사진 슬롯 2개(image/image2 — ADR-020). 슬롯 하나를 처리하는 헬퍼를 슬롯마다 호출한다.
const PHOTO_SLOTS = [
  { blob: "image", type: "imageType" },
  { blob: "image2", type: "image2Type" },
] as const;

async function toStored(c: Capture): Promise<unknown> {
  const rec: Record<string, unknown> = { ...c };
  let changed = false;
  for (const s of PHOTO_SLOTS) {
    const v = rec[s.blob];
    if (v instanceof Blob) {
      rec[s.blob] = await blobToBuf(v);
      rec[s.type] = v.type || "image/jpeg";
      changed = true;
    }
  }
  return changed ? rec : c; // 사진 없음 → 원본 그대로
}

function fromStored(rec: unknown): Capture {
  const r = rec as Record<string, unknown>;
  if (!r) return rec as Capture;
  let out: Record<string, unknown> | null = null;
  for (const s of PHOTO_SLOTS) {
    const v = r[s.blob];
    if (v instanceof ArrayBuffer) {
      out = out ?? { ...r };
      out[s.blob] = new Blob([v], { type: (r[s.type] as string) || "image/jpeg" });
    }
  }
  // 옛 Blob 레코드(Android) 또는 사진 없음 → 그대로. image2 없는 기존 레코드도 무변환 통과.
  return (out ?? rec) as Capture;
}

interface CaptureDB extends DBSchema {
  books: { key: string; value: Book };
  sessions: {
    key: string;
    value: Session;
    indexes: { byBook: string };
  };
  captures: {
    key: string;
    value: Capture;
    indexes: { bySession: string; byCreated: number };
  };
}

let dbp: Promise<IDBPDatabase<CaptureDB>> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB<CaptureDB>("capture", 1, {
      upgrade(d) {
        d.createObjectStore("books", { keyPath: "uuid" });
        const s = d.createObjectStore("sessions", { keyPath: "uuid" });
        s.createIndex("byBook", "bookId");
        const c = d.createObjectStore("captures", { keyPath: "uuid" });
        c.createIndex("bySession", "sessionId");
        c.createIndex("byCreated", "createdAt");
      },
    });
  }
  return dbp;
}

export const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);

// --- Books ---
export async function putBook(b: Book) {
  await (await db()).put("books", b);
  return b;
}
export async function getBook(id: string) {
  return (await db()).get("books", id);
}

// --- Sessions ---
export async function putSession(s: Session) {
  await (await db()).put("sessions", s);
  return s;
}
export async function getSession(id: string) {
  return (await db()).get("sessions", id);
}

// --- Captures ---
export async function addCapture(c: Capture) {
  const d = await db();
  await d.put("captures", await toStored(c) as Capture);
  // 세션에 최근 캡처 시각 기록 — recentBooks가 캡처 로드 없이 lastActivity 계산 (세션 레코드는 작음)
  const s = await d.get("sessions", c.sessionId);
  if (s) await d.put("sessions", { ...s, lastCaptureAt: c.createdAt });
  return c;
}
export async function getCapture(id: string): Promise<Capture | undefined> {
  const rec = await (await db()).get("captures", id);
  return rec == null ? undefined : fromStored(rec);
}
export async function updateCapture(c: Capture) {
  await (await db()).put("captures", await toStored(c) as Capture);
  return c;
}
export async function capturesForSession(sessionId: string): Promise<Capture[]> {
  const list = await (await db()).getAllFromIndex("captures", "bySession", sessionId);
  return list.map(fromStored).sort((a, b) => a.createdAt - b.createdAt);
}
export async function countCaptures(sessionId: string): Promise<number> {
  return (await db()).countFromIndex("captures", "bySession", sessionId);
}
export async function deleteCapture(id: string) {
  await (await db()).delete("captures", id);
}

// --- 검색 (ADR-022) ---
// 계약: 반환 타입에 이미지 필드를 담지 않는다. passage/memo가 이미지와 같은 레코드에
// 있어서, 텍스트를 찾겠다고 allCaptures()를 쓰면 모든 사진이 Blob으로 되살아난다
// (ADR-013/015). 여기서는 fromStored를 부르지 않고 텍스트만 뽑아 즉시 버린다.

/** 검색 결과 1건 — 이미지 필드가 없는 것이 이 타입의 계약이다. */
export interface CaptureHit {
  uuid: string;
  sessionId: string;
  createdAt: number;
  tag: Tag;
  snippet: string; // 매치 주변 발췌(양옆 말줄임)
  field: "passage" | "memo"; // why 매치는 memo로 보고한다(ADR-014)
}

export interface SearchResult {
  hits: CaptureHit[];
  truncated: boolean; // limit에 걸려 중단됨 — 화면에 반드시 표시할 것
}

const SNIPPET_BEFORE = 20;
const SNIPPET_AFTER = 60;
const YIELD_EVERY = 100;

function snippetAround(text: string, at: number, qLen: number): string {
  const s = Math.max(0, at - SNIPPET_BEFORE);
  const e = Math.min(text.length, at + qLen + SNIPPET_AFTER);
  return `${s > 0 ? "…" : ""}${text.slice(s, e)}${e < text.length ? "…" : ""}`;
}

/**
 * 캡처 본문 검색 — 최신 우선, limit에서 조기 종료.
 *
 * 커서를 쓰지 않는 이유: IDB 트랜잭션은 대기 중인 요청 없이 이벤트 루프로 나가면
 * 자동 종료된다. 커서 루프 안에서 setTimeout(0)으로 양보하면 트랜잭션이 죽어
 * 다음 continue()가 던진다. 그래서 값 없이 키만 먼저 받고(getAllKeysFromIndex —
 * uuid 문자열 배열뿐, 이미지 부담 0) 건별 get으로 훑는다. get은 각각 독립
 * 트랜잭션이라 언제든 양보해도 안전하고, 메모리 상주는 항상 한 건이다.
 */
export async function searchCaptures(q: string, limit = 200): Promise<SearchResult> {
  const needle = q.trim().toLowerCase();
  const hits: CaptureHit[] = [];
  if (!needle) return { hits, truncated: false };

  const d = await db();
  const keys = await d.getAllKeysFromIndex("captures", "byCreated"); // createdAt 오름차순
  let truncated = false;

  for (let i = keys.length - 1; i >= 0; i--) {
    // 최신 우선
    const rec = (await d.get("captures", keys[i])) as unknown as Record<string, unknown>;
    if (rec) {
      // 텍스트만 뽑고 레코드 참조는 이 블록을 벗어나며 버려진다
      const memo = [rec.memo, rec.why].filter((s) => s && String(s).trim()).join(" · ");
      const fields: [CaptureHit["field"], string][] = [
        ["passage", (rec.passage as string) ?? ""],
        ["memo", memo],
      ];
      for (const [field, text] of fields) {
        const at = text.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        hits.push({
          uuid: rec.uuid as string,
          sessionId: rec.sessionId as string,
          createdAt: rec.createdAt as number,
          tag: rec.tag as Tag,
          field,
          snippet: snippetAround(text, at, needle.length),
        });
        break; // 캡처당 1건
      }
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
    }
    // 이미지 ArrayBuffer가 건별로 디시리얼라이즈되므로 GC에 숨 쉴 틈을 준다(pdf.ts와 같은 이유)
    if ((keys.length - i) % YIELD_EVERY === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return { hits, truncated };
}

/** 세션 삭제 — 그 세션의 캡처 전부 삭제 후 세션 레코드 삭제. (deleteBook 내부 전용) */
async function deleteSession(sessionId: string): Promise<void> {
  const caps = await capturesForSession(sessionId);
  const d = await db();
  for (const c of caps) await d.delete("captures", c.uuid);
  await d.delete("sessions", sessionId);
}

/** 책 삭제 — 그 책의 모든 세션(+캡처) 삭제 후 책 레코드 삭제. */
export async function deleteBook(bookId: string): Promise<void> {
  const sessions = await sessionsForBook(bookId);
  for (const s of sessions) await deleteSession(s.uuid);
  await (await db()).delete("books", bookId);
}

// --- 목록/세션 라이프사이클 (ADR-005) ---
export async function listBooks(): Promise<Book[]> {
  return (await db()).getAll("books");
}
export async function allSessions(): Promise<Session[]> {
  return (await db()).getAll("sessions");
}
export async function allCaptures(): Promise<Capture[]> {
  const list = await (await db()).getAll("captures");
  return list.map(fromStored);
}

export async function sessionsForBook(bookId: string): Promise<Session[]> {
  return (await db()).getAllFromIndex("sessions", "byBook", bookId);
}

export async function capturesForBook(bookId: string): Promise<Capture[]> {
  const sessions = await sessionsForBook(bookId);
  const all: Capture[] = [];
  for (const s of sessions) all.push(...(await capturesForSession(s.uuid)));
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

/** 그 책의 열린 회독만 종료(다른 책 무관). */
async function endOpenRoundsForBook(bookId: string, now: number): Promise<void> {
  const ss = await sessionsForBook(bookId);
  const d = await db();
  for (const s of ss) if (s.ended == null) await d.put("sessions", { ...s, ended: now });
}

/** 새 세션(회독) 시작 — 그 책의 열린 회독 종료 후 생성(ADR-005, ADR-016). 새 세션 uuid 반환. */
export async function startNewSession(bookId: string, project?: string): Promise<string> {
  const now = Date.now();
  const ss = await sessionsForBook(bookId);
  const prev = [...ss].sort((a, b) => b.started - a.started)[0];
  const nextNo = prev ? displayRoundNo(ss, prev) + 1 : 1;
  await endOpenRoundsForBook(bookId, now);
  const session: Session = { uuid: uuid(), bookId, project, started: now, ended: null, roundNo: nextNo };
  await putSession(session);
  return session.uuid;
}

/** 현재 회독 get-or-create — 아무것도 닫지 않음. 모든 캡처 진입/공유 수신 전용. */
export async function currentRoundFor(bookId: string): Promise<string> {
  const ss = await sessionsForBook(bookId);
  const open = ss.filter((s) => s.ended == null).sort((a, b) => b.started - a.started);
  if (open.length) return open[0].uuid; // 레거시 다중 열림: 최근 것
  const prev = [...ss].sort((a, b) => b.started - a.started)[0];
  const nextNo = prev ? displayRoundNo(ss, prev) + 1 : 1;
  const session: Session = { uuid: uuid(), bookId, started: Date.now(), ended: null, roundNo: nextNo };
  await putSession(session);
  return session.uuid;
}

/** 회독 번호: started asc 정렬(JS sort 필수) 1-based. */
export function roundNumberOf(sessions: Session[], sessionId: string): number {
  const sorted = [...sessions].sort((a, b) => a.started - b.started);
  return sorted.findIndex((s) => s.uuid === sessionId) + 1;
}

/** 표시용 회독 번호 — override(roundNo) 있으면 그것, 없으면 계산값. */
export function displayRoundNo(sessions: Session[], s: Session): number {
  return s.roundNo ?? roundNumberOf(sessions, s.uuid);
}

export interface BookView {
  book: Book;
  currentRound: Session | null;
  roundNumber: number;   // currentRound의 순번, 없으면 totalRounds
  totalRounds: number;
  captureCount: number;
  lastActivity: number;  // 캡처/세션 중 최신
}

/** 최근 활동순 책 목록 — 캡처 없는 책도 포함(lastActivity: 0이면 맨 뒤). */
export async function recentBooks(n: number): Promise<BookView[]> {
  const books = await listBooks();
  const views: BookView[] = [];
  for (const book of books) {
    const ss = await sessionsForBook(book.uuid);
    if (!ss.length) {
      views.push({ book, currentRound: null, roundNumber: 0, totalRounds: 0, captureCount: 0, lastActivity: 0 });
      continue;
    }
    const open = ss.filter((s) => s.ended == null).sort((a, b) => b.started - a.started);
    const currentRound = open[0] ?? null;
    // 캡처 레코드 로드 없이 계산 — countFromIndex + Session.lastCaptureAt (이미지 실체화 제거)
    let captureCount = 0;
    for (const s of ss) captureCount += await countCaptures(s.uuid);
    // 레거시(lastCaptureAt 없는 세션)는 started 폴백 — 새 캡처부터 자가 교정
    const lastActivity = Math.max(...ss.map((s) => Math.max(s.started, s.lastCaptureAt ?? 0)));
    views.push({
      book,
      currentRound,
      roundNumber: currentRound
        ? displayRoundNo(ss, currentRound)
        : displayRoundNo(ss, [...ss].sort((a, b) => b.started - a.started)[0]),
      totalRounds: ss.length,
      captureCount,
      lastActivity,
    });
  }
  return views.sort((a, b) => b.lastActivity - a.lastActivity).slice(0, n);
}

/** 책의 캡처를 회독별로 그룹화 — 빈 회독 제외, started asc 순. */
export async function capturesWithRoundsForBook(
  bookId: string,
): Promise<{ roundNumber: number; session: Session; captures: Capture[] }[]> {
  const ss = [...(await sessionsForBook(bookId))].sort((a, b) => a.started - b.started);
  const out: { roundNumber: number; session: Session; captures: Capture[] }[] = [];
  for (let i = 0; i < ss.length; i++) {
    const captures = await capturesForSession(ss[i].uuid);
    if (captures.length) out.push({ roundNumber: displayRoundNo(ss, ss[i]), session: ss[i], captures });
  }
  return out;
}
