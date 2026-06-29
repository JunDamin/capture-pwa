/** IndexedDB 저장소 — PRD §12. 서버/로그인 없음. 이미지는 Blob(ADR-003). */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Book, Capture, Session } from "./types.ts";

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
  await (await db()).put("captures", c);
  return c;
}
export async function updateCapture(c: Capture) {
  await (await db()).put("captures", c);
  return c;
}
export async function capturesForSession(sessionId: string): Promise<Capture[]> {
  const list = await (await db()).getAllFromIndex("captures", "bySession", sessionId);
  return list.sort((a, b) => a.createdAt - b.createdAt);
}
export async function countCaptures(sessionId: string): Promise<number> {
  return (await db()).countFromIndex("captures", "bySession", sessionId);
}
export async function deleteCapture(id: string) {
  await (await db()).delete("captures", id);
}

// --- 목록/세션 라이프사이클 (ADR-005) ---
export async function listBooks(): Promise<Book[]> {
  return (await db()).getAll("books");
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

/** 다른 책으로 새 세션 시작 시 기존 열린 세션 종료(ADR-005). */
export async function endAllOpenSessions(now: number, exceptId?: string) {
  const open = (await (await db()).getAll("sessions")).filter(
    (s) => s.ended == null && s.uuid !== exceptId,
  );
  for (const s of open) {
    const v = await toView(s);
    await putSession({ ...s, ended: v.lastActivity || now });
  }
}

/** 비활동 자동 종료 — 마지막 활동 후 maxIdleMs 경과한 열린 세션을 닫는다(ADR-005). */
export async function endStaleSessions(now: number, maxIdleMs = 8 * 60 * 60 * 1000) {
  const open = (await (await db()).getAll("sessions")).filter((s) => s.ended == null);
  for (const s of open) {
    const v = await toView(s);
    if (now - v.lastActivity > maxIdleMs) {
      await putSession({ ...s, ended: v.lastActivity });
    }
  }
}
