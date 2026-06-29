/**
 * prompt.md 빌더 — ADR-008/009. 버전된 고정 템플릿 v1.
 * 지시문 + 태그 범례 + 구조화된 캡처 데이터 + OCR 지시 + 규칙 분류(ADR-007).
 * 첨부 사진과 캡처는 파일명 번호(capture-NN)로 엮인다.
 */
import { TAGS, type Capture } from "../db/types.ts";

export const PROMPT_TEMPLATE_VERSION = "v1";

export interface ExportContext {
  bookTitle: string;
  author?: string;
  project?: string;
  scopeLabel: string; // "이번 세션" | "이 책 전체"
  captures: Capture[];
}

export interface ExportPackage {
  promptMd: string;
  files: { name: string; blob: Blob }[]; // prompt.md + capture-NN.jpg
  imageCount: number;
}

const tagMeta = (k: string) => TAGS.find((t) => t.key === k)!;

function fmtTime(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pad(i: number) {
  return String(i + 1).padStart(2, "0");
}

export function buildExport(ctx: ExportContext): ExportPackage {
  const { captures } = ctx;
  const files: { name: string; blob: Blob }[] = [];

  // 캡처별 본문 + 이미지 파일 수집
  const blocks = captures.map((c, i) => {
    const tag = tagMeta(c.tag);
    let imgLine = "사진 없음";
    if (c.image) {
      const name = `capture-${pad(i)}.jpg`;
      files.push({ name, blob: c.image });
      imgLine = `${name} (첨부)`;
    }
    const lines = [
      `### capture-${pad(i)} · ${tag.emoji} ${tag.label} · ${fmtTime(c.createdAt)}`,
      `- 왜: ${c.why ?? "(없음)"}`,
    ];
    if (c.memo) lines.push(`- 메모: ${c.memo}`);
    lines.push(`- 사진: ${imgLine}`);
    return lines.join("\n");
  });

  // 규칙 기반 사전 분류 (ADR-007)
  const tagDist = TAGS.map((t) => {
    const n = captures.filter((c) => c.tag === t.key).length;
    return n ? `${t.emoji} ${t.label} ${n}` : null;
  })
    .filter(Boolean)
    .join(" · ");
  const idxList = (pred: (c: Capture) => boolean) =>
    captures
      .map((c, i) => (pred(c) ? `capture-${pad(i)}` : null))
      .filter(Boolean)
      .join(", ") || "(없음)";
  const writingCandidates = idxList((c) => c.why === "글감");
  const noWhy = idxList((c) => !c.why);

  const author = ctx.author ? ` (${ctx.author})` : "";
  const project = ctx.project ? `\n- 목적(프로젝트): ${ctx.project}` : "";

  const md = `# 독서 캡처 — ${ctx.bookTitle}${author}

- 범위: ${ctx.scopeLabel}${project}
- 캡처 수: ${captures.length}
- 템플릿: capture-prompt ${PROMPT_TEMPLATE_VERSION}

## 너에게 (지시)

나는 책을 읽으며 떠오른 생각을 빠르게 캡처했다. 아래는 그 원본이다.
각 캡처에는 내가 붙인 **태그**(아래 범례)와 **"왜 저장했나"**가 있다.
함께 첨부한 사진들은 책 페이지다. **각 사진을 OCR**해서, 파일명의 번호(\`capture-NN\`)로 아래 캡처와 연결하라.

그런 다음 아래를 만들어라:

1. **주요 주제** — 반복해서 나타나는 생각의 묶음
2. **반복된 생각 / 강조점**
3. **캡처 간 관계** — 서로 연결되거나 충돌하는 것
4. **글감 후보** — 블로그/글로 발전시킬 만한 것
5. **인터뷰 질문** — 이 주제로 누군가와 대화한다면
6. **독서노트 초안** — 위를 종합한 정리

## 태그 범례

${TAGS.map((t) => `- ${t.emoji} ${t.label}`).join("\n")}

## 캡처 (${captures.length}개)

${blocks.join("\n\n")}

## 규칙 기반 사전 분류 (참고 — 출발점으로만)

- 태그 분포: ${tagDist || "(없음)"}
- "글감" 후보: ${writingCandidates}
- "왜" 없는 캡처: ${noWhy}
`;

  // prompt.md를 파일 목록 맨 앞에
  files.unshift({ name: "prompt.md", blob: new Blob([md], { type: "text/markdown" }) });

  return { promptMd: md, files, imageCount: captures.filter((c) => c.image).length };
}
