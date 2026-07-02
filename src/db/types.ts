/** 도메인 타입 — docs/glossary.md, PRD §11, ADR-001~006 */

export type Tag = "interesting" | "important" | "connected" | "question" | "idea";

export const TAGS: { key: Tag; emoji: string; label: string }[] = [
  { key: "interesting", emoji: "💡", label: "흥미롭다" },
  { key: "important", emoji: "⭐", label: "중요하다" },
  { key: "connected", emoji: "🔗", label: "연결된다" },
  { key: "question", emoji: "❓", label: "의문이다" },
  { key: "idea", emoji: "🌱", label: "아이디어" },
];

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
  roundNo?: number | null; // 회독 번호 수정용 override — 표시 = roundNo ?? 계산
}

export interface Capture {
  uuid: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  image: Blob | null; // ADR-001/003
  imageW?: number;
  imageH?: number;
  passage: string | null; // 책에서 담고 싶은 글/인용 — image와 함께 "내용" (ADR-014)
  memo: string | null; // note: 내 생각·주석 (why 흡수)
  tag: Tag; // 필수, 단일 — ADR-002/004
  why?: string | null; // @deprecated 레거시 읽기 전용 — note로 합쳐 표시 (ADR-014)
  page?: number; // 책 페이지 번호 — 선택(사후 입력 가능)
  ocr: string | null;
  exportStatus: "none" | "exported";
}

/** 유효성 — ADR-014: (image 또는 passage) + tag. memo는 레거시 호환. */
export function isValidCapture(c: Pick<Capture, "image" | "passage" | "memo" | "tag">): boolean {
  const hasContent =
    c.image != null ||
    (c.passage != null && c.passage.trim() !== "") ||
    (c.memo != null && c.memo.trim() !== "");
  return hasContent && !!c.tag;
}
