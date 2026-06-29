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
