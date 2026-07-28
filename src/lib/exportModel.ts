/**
 * 캡처 → 표현(Export) 변환 단일화 — 딥모듈(좁은 인터페이스).
 * prompt.ts(prompt.md)와 pdf.ts(사진 캡션)가 같은 파생 규칙을 공유한다:
 * 번호(capture-NN)·note 병합(memo + 레거시 why)·시각 포맷. 둘은 파일명 번호로
 * 서로를 참조하므로 번호 매김이 반드시 lockstep이어야 한다.
 */
import { TAGS, type Capture } from "../db/types.ts";
import { formatTime } from "./ui.ts";

export interface CaptureRow {
  num: string; // "01" (padStart 2)
  fileName: string; // "capture-01.jpg"
  tagEmoji: string;
  tagLabel: string;
  time: string; // "YYYY-MM-DD HH:mm"
  passage: string | null; // trim된 담은 글(비면 null)
  note: string | null; // memo + 레거시 why 병합(비면 null)
  page: number | null;
  hasImage: boolean;
}

/** memo + 레거시 why 병합 — ADR-014. 둘 다 비면 null. */
export function captureNote(c: Capture): string | null {
  return [c.memo, c.why].filter((s) => s && s.trim()).join(" · ") || null;
}

export function captureRows(captures: Capture[]): CaptureRow[] {
  return captures.map((c, i) => {
    const num = String(i + 1).padStart(2, "0");
    const tag = TAGS.find((t) => t.key === c.tag)!;
    const passage = c.passage && c.passage.trim() ? c.passage.trim() : null;
    return {
      num,
      fileName: `capture-${num}.jpg`,
      tagEmoji: tag.emoji,
      tagLabel: tag.label,
      time: formatTime(c.createdAt, "full"),
      passage,
      note: captureNote(c),
      page: c.page ?? null,
      hasImage: !!c.image,
    };
  });
}
