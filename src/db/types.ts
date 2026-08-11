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
  cover?: ArrayBuffer | null; // 표지(저장형 ArrayBuffer — ADR-015). instanceof 가드로만 렌더.
  coverType?: string; // MIME (기본 image/jpeg)
}

export interface Session {
  uuid: string;
  bookId: string;
  project?: string;
  started: number;
  ended: number | null; // 열린 세션 = null — ADR-005
  roundNo?: number | null; // 회독 번호 수정용 override — 표시 = roundNo ?? 계산
  lastCaptureAt?: number; // 최근 캡처 시각 — recentBooks 정렬용, addCapture가 갱신 (선택 — 마이그레이션 불필요)
}

export interface Capture {
  uuid: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  image: Blob | null; // 사진 1장째 — ADR-001/003
  imageW?: number;
  imageH?: number;
  image2?: Blob | null; // 사진 2장째 — 같은 글이 페이지를 넘어 이어질 때 (ADR-020)
  image2W?: number;
  image2H?: number;
  passage: string | null; // 책에서 담고 싶은 글/인용 — image와 함께 "내용" (ADR-014)
  memo: string | null; // note: 내 생각·주석 (why 흡수)
  tag: Tag; // 필수, 단일 — ADR-002/004
  why?: string | null; // @deprecated 레거시 읽기 전용 — note로 합쳐 표시 (ADR-014)
  page?: number; // 책 페이지 번호 — 선택(사후 입력 가능)
  ocr: string | null;
  exportStatus: "none" | "exported";
}

/** 캡처당 사진 상한 — ADR-020. 슬롯은 image / image2 두 개뿐이다. */
export const MAX_PHOTOS = 2;

export interface Photo {
  blob: Blob;
  width?: number;
  height?: number;
}

export type PhotoSlots = Pick<
  Capture,
  "image" | "imageW" | "imageH" | "image2" | "image2W" | "image2H"
>;

/**
 * 캡처의 사진을 순서대로 배열로 — ADR-020.
 * 저장은 슬롯 2개(image/image2)지만 소비자는 전부 이 접근자만 쓴다.
 * 2장이면 [앞 페이지, 뒤 페이지] 순서이며 같은 글이 이어진 것이다.
 */
export function capturePhotos(c: Partial<PhotoSlots>): Photo[] {
  const out: Photo[] = [];
  if (c.image) out.push({ blob: c.image, width: c.imageW, height: c.imageH });
  if (c.image2) out.push({ blob: c.image2, width: c.image2W, height: c.image2H });
  return out;
}

/** 사진 슬롯을 배열로부터 다시 채운다 — 저장 직전 조립용(빈 슬롯은 null). */
export function photoSlots(photos: Photo[]): PhotoSlots {
  const [a, b] = photos.slice(0, MAX_PHOTOS);
  return {
    image: a?.blob ?? null,
    imageW: a?.width,
    imageH: a?.height,
    image2: b?.blob ?? null,
    image2W: b?.width,
    image2H: b?.height,
  };
}

/** 유효성 — ADR-014: (사진 ‖ passage ‖ memo) + tag. 생각(memo)만 저장하는 것도 1급 경로. */
export function isValidCapture(
  c: Pick<Capture, "passage" | "memo" | "tag"> & Partial<PhotoSlots>,
): boolean {
  const hasContent =
    capturePhotos(c).length > 0 ||
    (c.passage != null && c.passage.trim() !== "") ||
    (c.memo != null && c.memo.trim() !== "");
  return hasContent && !!c.tag;
}
