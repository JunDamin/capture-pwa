/** 캡처 상세 + 편집 — 큰 사진 + 태그/왜/메모/페이지 수정. PRD §8, ADR-004. */
import type { Nav, Scope } from "../app.ts";
import { getCapture, updateCapture } from "../db/db.ts";
import { TAGS, isValidCapture, type Capture, type Tag } from "../db/types.ts";
import { openImageViewer } from "../lib/viewer.ts";

export function mountDetail(
  root: HTMLElement,
  nav: Nav,
  captureId: string,
  from: { scope: Scope; id: string },
): () => void {
  const urls: string[] = [];
  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;

  const back = () => nav({ name: "review", scope: from.scope, id: from.id });

  (async () => {
    const cap = await getCapture(captureId);
    if (!cap) return back();
    render(cap);
  })();

  function render(cap: Capture) {
    let tag: Tag = cap.tag;

    const tagPills = TAGS.map(
      (t) =>
        `<button class="tagpill ${t.key === tag ? "is-sel" : ""}" data-tag="${t.key}">${t.emoji} ${t.label}</button>`,
    ).join("");

    const d = new Date(cap.createdAt);
    const p = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;

    root.innerHTML = `
    <div class="scr scr--light detail">
      <div class="topbar">
        <button class="iconbtn back">‹</button>
        <div class="topbar__t">캡처</div>
      </div>

      <div class="detail__photo ${cap.image ? "" : "detail__photo--none"}">${cap.image ? "" : "📝"}</div>

      <div class="card">
        <div class="card__h">한 가지 태그를 고르세요</div>
        <div class="tagpills">${tagPills}</div>
      </div>

      <div class="card">
        <div class="card__h">담은 글</div>
        <textarea class="field detail__passage" rows="3" placeholder="책에서 담고 싶은 글 (선택)">${esc(cap.passage ?? "")}</textarea>
      </div>

      <div class="card">
        <div class="card__h">내 생각</div>
        <textarea class="field detail__memo" rows="3" placeholder="내 생각·메모 (선택)">${esc([cap.memo, cap.why].filter((s)=>s&&s.trim()).join(" · "))}</textarea>
      </div>

      <div class="card detail__pagerow">
        <span class="card__h">📖 페이지</span>
        <input class="field detail__page" type="number" inputmode="numeric" min="1" placeholder="선택" value="${cap.page ?? ""}" />
      </div>

      <div class="detail__stamp">${stamp}</div>

      <button class="btn-primary save">저장</button>
    </div>`;

    if (cap.image) {
      const u = URL.createObjectURL(cap.image);
      urls.push(u);
      (root.querySelector(".detail__photo") as HTMLElement).style.backgroundImage = `url(${u})`;
    }

    const photoEl = root.querySelector(".detail__photo") as HTMLElement;
    if (cap.image) {
      photoEl.title = "탭하면 확대";
      photoEl.setAttribute("aria-label", "탭하면 확대");
      photoEl.onclick = () => {
        if (!cap.image) return;
        openImageViewer(cap.image, {
          onCrop: async (blob, w, h) => {
            cap.image = blob;
            cap.imageW = w;
            cap.imageH = h;
            await updateCapture({ ...cap, image: blob, imageW: w, imageH: h, updatedAt: Date.now() });
            // 상세 썸네일 갱신
            const u = URL.createObjectURL(blob);
            urls.push(u);
            photoEl.style.backgroundImage = `url(${u})`;
          },
        });
      };
    }

    (root.querySelector(".back") as HTMLElement).onclick = back;

    const passageEl = root.querySelector(".detail__passage") as HTMLTextAreaElement;
    const memo = root.querySelector(".detail__memo") as HTMLTextAreaElement;
    const pageEl = root.querySelector(".detail__page") as HTMLInputElement;
    const tagEls = Array.from(root.querySelectorAll(".tagpill")) as HTMLElement[];

    tagEls.forEach((el) => {
      el.onclick = () => {
        tag = el.dataset.tag as Tag;
        tagEls.forEach((x) => x.classList.toggle("is-sel", x === el));
      };
    });

    (root.querySelector(".save") as HTMLButtonElement).onclick = async () => {
      const passageVal = passageEl.value.trim() || null;
      const memoVal = memo.value.trim() || null;
      const n = parseInt(pageEl.value, 10);
      const page = Number.isFinite(n) && n > 0 ? n : undefined;
      if (!isValidCapture({ image: cap.image, passage: passageVal, memo: memoVal, tag })) {
        alert("담고 싶은 글이나 사진이 필요해요.");
        return;
      }
      await updateCapture({ ...cap, tag, passage: passageVal, memo: memoVal, why: null, page, updatedAt: Date.now() });
      back();
    };
  }

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
