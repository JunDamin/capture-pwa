/**
 * prompt.md 빌더 — ADR-008/009. 버전된 고정 템플릿 v4.
 * 지시문 + 태그 범례 + 구조화된 캡처 데이터 + OCR 지시 + 규칙 분류(ADR-007).
 * 첨부 사진과 캡처는 파일명 번호(capture-NN)로 엮인다.
 */
import { TAGS, type Capture } from "../db/types.ts";

export const PROMPT_TEMPLATE_VERSION = "v4";

export interface ExportContext {
  bookTitle: string;
  author?: string;
  project?: string;
  scopeLabel: string; // "최근 기록" | "이 책 전체"
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
    const note = [c.memo, c.why].filter((s) => s && s.trim()).join(" · ") || null; // 레거시 why 합치기
    const lines = [
      `### capture-${pad(i)} · ${tag.emoji} ${tag.label} · ${fmtTime(c.createdAt)}${c.page ? ` · p.${c.page}` : ""}`,
    ];
    if (c.passage && c.passage.trim()) lines.push(`- 담은 글: ${c.passage.trim()}`);
    if (note) lines.push(`- 내 생각: ${note}`);
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
  const author = ctx.author ? ` (${ctx.author})` : "";
  const project = ctx.project ? `\n- 목적(프로젝트): ${ctx.project}` : "";

  const md = `# 독서 캡처 — ${ctx.bookTitle}${author}

- 범위: ${ctx.scopeLabel}${project}
- 캡처 수: ${captures.length}
- 템플릿: capture-prompt ${PROMPT_TEMPLATE_VERSION}

## 너에게 (지시)

나는 책을 읽으며 떠오른 생각을 빠르게 캡처했다. 각 캡처에는 **태그**, 책에서 **담은 글(passage)**, **내 생각(note)**, 그리고 첨부 사진이 있을 수 있다. 첨부 사진은 책 페이지다.

**작업 방식(중요):** 한 번에 다 하려 하지 마라. **이번 응답에서는 1단계(전사)만** 수행한다. 분량이 많으면 여러 응답에 나눠도 된다 — 응답 한도에 가까워지면 끊고 "**계속이라고 입력하면 이어서 전사합니다**"라고 말한 뒤 기다려라. **분량이 많다는 이유로 거부하거나 요약으로 대체하는 것은 금지다.** 전사가 전부 끝나면 "전사 완료 — 계속이라고 입력하면 2단계 분석을 시작합니다"라고 말하고 기다려라.

### 1단계 — 원문 전사 (이번 응답)

**각 캡처의 원문을 그대로 출력하라.** 이것이 이후 모든 작업의 기초자료다. **요약·의역·생략 금지.**
- **사진이 있는 캡처:** 사진을 OCR해 **원문 그대로 전사**하라. 허용되는 수정은 오탈자·줄바꿈·잘린 글자 교정뿐 — 문장을 줄이거나 바꾸지 마라.
- **담은 글·내 생각:** **한 글자도 바꾸지 말고 그대로 옮겨라.** 내 생각(note)은 요약하지 말고 원문 그대로 쓴다.
- **사진이 없는 캡처:** 담은 글·내 생각을 그대로 옮긴다. **사진만 있는 캡처:** OCR 전사만.
각 캡처를 파일명 번호(\`capture-NN\`)로 표시하고, **번호 순서대로 빠짐없이** 전사하라.

### 2단계 — 분석 (전사 완료 후, 내가 "계속"이라고 하면)

1단계의 전사본을 **근거로** 만들어라.
1. **주요 주제** 2. **반복/강조** 3. **캡처 간 관계(연결·충돌)** 4. **글감 후보** 5. **인터뷰 질문** 6. **독서노트 초안**

## 태그 범례

${TAGS.map((t) => `- ${t.emoji} ${t.label}`).join("\n")}

## 캡처 (${captures.length}개)

${blocks.join("\n\n")}

## 참고 — 태그 분포

${tagDist || "(없음)"}
`;

  // prompt.md를 파일 목록 맨 앞에
  files.unshift({ name: "prompt.md", blob: new Blob([md], { type: "text/markdown" }) });

  return { promptMd: md, files, imageCount: captures.filter((c) => c.image).length };
}
