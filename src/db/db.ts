/** IndexedDB 저장소 — PRD §12. 서버/로그인 없음. 이미지는 ArrayBuffer(ADR-015, ADR-003 개정). */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Book, Capture, Session } from "./types.ts";

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

async function toStored(c: Capture): Promise<unknown> {
  if (c.image instanceof Blob) {
    const buf = await blobToBuf(c.image);
    return { ...c, image: buf, imageType: c.image.type || "image/jpeg" };
  }
  return c; // image null
}

function fromStored(rec: unknown): Capture {
  const r = rec as Record<string, unknown>;
  if (r && r.image instanceof ArrayBuffer) {
    return { ...r, image: new Blob([r.image], { type: (r.imageType as string) || "image/jpeg" }) } as Capture;
  }
  return rec as Capture; // 옛 Blob 레코드(Android) 또는 image null → 그대로
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
  await (await db()).put("captures", await toStored(c) as Capture);
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

/** 세션 삭제 — 그 세션의 캡처 전부 삭제 후 세션 레코드 삭제. */
export async function deleteSession(sessionId: string): Promise<void> {
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

export interface SessionView {
  session: Session;
  bookTitle: string;
  count: number;
  lastActivity: number;
}

async function toView(s: Session): Promise<SessionView> {
  const caps = await capturesForSession(s.uuid);
  const book = await getBook(s.bookId);
  const lastActivity = caps.reduce((m, c) => Math.max(m, c.createdAt), s.started);
  return { session: s, bookTitle: book?.title ?? "(삭제된 책)", count: caps.length, lastActivity };
}

/** 최근 세션 — 마지막 활동 기준 내림차순. */
export async function recentSessions(limit = 10): Promise<SessionView[]> {
  const all = await (await db()).getAll("sessions");
  const views = await Promise.all(all.map(toView));
  return views.sort((a, b) => b.lastActivity - a.lastActivity).slice(0, limit);
}

/** 열린(미종료) 세션 중 가장 최근 것 — 이어읽기 대상. */
export async function openSession(): Promise<SessionView | null> {
  const open = (await (await db()).getAll("sessions")).filter((s) => s.ended == null);
  if (!open.length) return null;
  const views = await Promise.all(open.map(toView));
  views.sort((a, b) => b.lastActivity - a.lastActivity);
  return views[0];
}

export async function endSession(id: string, endedAt: number) {
  const s = await getSession(id);
  if (s && s.ended == null) await putSession({ ...s, ended: endedAt });
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
    let captureCount = 0;
    let lastActivity = Math.max(...ss.map((s) => s.started));
    for (const s of ss) {
      const caps = await capturesForSession(s.uuid);
      captureCount += caps.length;
      for (const c of caps) if (c.createdAt > lastActivity) lastActivity = c.createdAt;
    }
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
