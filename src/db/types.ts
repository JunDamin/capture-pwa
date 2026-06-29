/** 도메인 타입 — docs/glossary.md, PRD §11, ADR-001~006 */

export type Tag = "interesting" | "important" | "connected" | "question" | "idea";

export const TAGS: { key: Tag; emoji: string; label: string }[] = [
  { key: "interesting", emoji: "💡", label: "흥미롭다" },
  { key: "important", emoji: "⭐", label: "중요하다" },
  { key: "connected", emoji: "🔗", label: "연결된다" },
  { key: "question", emoji: "❓", label: "의문이다" },
  { key: "idea", emoji: "🌱", label: "아이디어" },
];

/** Why 칩 — ADR-001/004. 자유입력은 별도(free text). */
export const WHY_CHIPS = [
  "프로젝트에 써먹기",
  "다시 읽고 싶음",
  "반대되는 생각",
  "글감",
] as const;

export interface Book {
  uuid: string;
  title: string; // 필수 — ADR-006
  author?: string;
  isbn?: string;
  cover?: Blob;
}

export interface Session {
  uuid: string;
  bookId: string;
  project?: string;
  started: number;
  ended: number | null; // 열린 세션 = null — ADR-005
}

export interface Capture {
  uuid: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  image: Blob | null; // ADR-001/003
  imageW?: number;
  imageH?: number;
  memo: string | null;
  tag: Tag; // 필수, 단일 — ADR-002/004
  why: string | null; // 선택 — ADR-004
  ocr: string | null;
  exportStatus: "none" | "exported";
}

/** 유효성 — ADR-004: (image 또는 memo) + tag */
export function isValidCapture(c: Pick<Capture, "image" | "memo" | "tag">): boolean {
  const hasContent = c.image != null || (c.memo != null && c.memo.trim() !== "");
  return hasContent && !!c.tag;
}
