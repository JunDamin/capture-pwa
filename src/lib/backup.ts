/** 전체 데이터 백업/복원 — 단일 JSON. 이미지 Blob↔base64 dataURL. uuid upsert 복원. */
import {
  allCaptures,
  allSessions,
  listBooks,
  putBook,
  putSession,
  updateCapture,
} from "../db/db.ts";
import type { Book, Capture, Session } from "../db/types.ts";

interface CaptureBackup extends Omit<Capture, "image"> {
  image: string | null; // dataURL 또는 null
}
interface BackupBundle {
  version: 1;
  exportedAt: number;
  books: Book[];
  sessions: Session[];
  captures: CaptureBackup[];
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
async function dataUrlToBlob(u: string): Promise<Blob> {
  return (await fetch(u)).blob();
}

export async function buildBackup(now: number): Promise<Blob> {
  const [books, sessions, caps] = await Promise.all([listBooks(), allSessions(), allCaptures()]);
  const captures: CaptureBackup[] = [];
  for (const c of caps) {
    const { image, ...rest } = c;
    captures.push({ ...rest, image: image ? await blobToDataUrl(image) : null });
  }
  const bundle: BackupBundle = { version: 1, exportedAt: now, books, sessions, captures };
  return new Blob([JSON.stringify(bundle)], { type: "application/json" });
}

export interface ImportResult {
  books: number;
  sessions: number;
  captures: number;
}

export async function importBackup(text: string): Promise<ImportResult> {
  const b = JSON.parse(text) as BackupBundle;
  if (
    b.version !== 1 ||
    !Array.isArray(b.books) ||
    !Array.isArray(b.sessions) ||
    !Array.isArray(b.captures)
  ) {
    throw new Error("unsupported backup");
  }
  for (const bk of b.books) await putBook(bk);
  for (const s of b.sessions) await putSession(s);
  for (const c of b.captures) {
    const { image, ...rest } = c;
    const cap: Capture = { ...(rest as Omit<Capture, "image">), image: image ? await dataUrlToBlob(image) : null };
    await updateCapture(cap);
  }
  return { books: b.books.length, sessions: b.sessions.length, captures: b.captures.length };
}
