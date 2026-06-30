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

/** 새 세션 시작 — 기존 열린 세션 종료 후 생성(ADR-005). 새 세션 uuid 반환. */
export async function startNewSession(bookId: string, project?: string): Promise<string> {
  const now = Date.now();
  await endAllOpenSessions(now);
  const session: Session = { uuid: uuid(), bookId, project, started: now, ended: null };
  await putSession(session);
  return session.uuid;
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
