/**
 * 캡처 → 표현(Export) 변환 단일화 — 딥모듈(좁은 인터페이스).
 * prompt.ts(prompt.md)와 pdf.ts(사진 캡션)가 같은 파생 규칙을 공유한다:
 * 번호(capture-NN)·note 병합(memo + 레거시 why)·시각 포맷. 둘은 파일명 번호로
 * 서로를 참조하므로 번호 매김이 반드시 lockstep이어야 한다.
 *
 * 번호 규칙(ADR-020): 사진 1장이면 capture-03.jpg, 2장이면 capture-03a.jpg /
 * capture-03b.jpg — 2장은 같은 글이 페이지를 넘어 이어진 것이다.
 */
import { capturePhotos, TAGS, type Capture, type Photo } from "../db/types.ts";
import { formatTime } from "./ui.ts";

export interface PhotoRef extends Photo {
  fileName: string; // "capture-01.jpg" | "capture-01a.jpg"
  label: string; // 파일명에서 확장자를 뺀 것 — PDF 페이지 헤더
}

export interface CaptureRow {
  num: string; // "01" (padStart 2)
  tagEmoji: string;
  tagLabel: string;
  time: string; // "YYYY-MM-DD HH:mm"
  passage: string | null; // trim된 담은 글(비면 null)
  note: string | null; // memo + 레거시 why 병합(비면 null)
  page: number | null;
  photos: PhotoRef[]; // 0~2장. 2장이면 [앞 페이지, 뒤 페이지]
}

/** memo + 레거시 why 병합 — ADR-014. 둘 다 비면 null. */
export function captureNote(c: Capture): string | null {
  return [c.memo, c.why].filter((s) => s && s.trim()).join(" · ") || null;
}

/** 사진 총 장수 — pdf.ts 요약과 prompt.ts 통계가 갈라지지 않도록 여기 하나로. */
export function totalPhotoCount(captures: Capture[]): number {
  return captures.reduce((n, c) => n + capturePhotos(c).length, 0);
}

export function captureRows(captures: Capture[]): CaptureRow[] {
  return captures.map((c, i) => {
    const num = String(i + 1).padStart(2, "0");
    const tag = TAGS.find((t) => t.key === c.tag)!;
    const passage = c.passage && c.passage.trim() ? c.passage.trim() : null;
    const shots = capturePhotos(c);
    // 1장이면 접미사 없음(기존 표기 유지), 2장이면 a/b로 갈라 이어짐을 표현
    const photos: PhotoRef[] = shots.map((p, j) => {
      const label = `capture-${num}${shots.length > 1 ? "ab"[j] : ""}`;
      return { ...p, label, fileName: `${label}.jpg` };
    });
    return {
      num,
      tagEmoji: tag.emoji,
      tagLabel: tag.label,
      time: formatTime(c.createdAt, "full"),
      passage,
      note: captureNote(c),
      page: c.page ?? null,
      photos,
    };
  });
}
