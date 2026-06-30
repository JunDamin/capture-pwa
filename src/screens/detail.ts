/** 캡처 상세 + 편집 — 큰 사진 + 태그/왜/메모/페이지 수정. PRD §8, ADR-004. */
import type { Nav, Scope } from "../app.ts";
import { getCapture, updateCapture } from "../db/db.ts";
import { TAGS, WHY_CHIPS, isValidCapture, type Capture, type Tag } from "../db/types.ts";
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
    let why: string | null = cap.why;
    let freeMode = why != null && !WHY_CHIPS.includes(why as never);

    const tagPills = TAGS.map(
      (t) =>
        `<button class="tagpill ${t.key === tag ? "is-sel" : ""}" data-tag="${t.key}">${t.emoji} ${t.label}</button>`,
    ).join("");
    const whyChips = WHY_CHIPS.map(
      (w) =>
        `<button class="chip ${!freeMode && why === w ? "is-sel" : ""}" data-why="${w}">${esc(w)}</button>`,
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
        <h2 class="detail__q">왜 저장했나요?</h2>
        <div class="chips">
          ${whyChips}
          <button class="chip chip--write ${freeMode ? "is-sel" : ""}">직접 입력…</button>
        </div>
        <textarea class="field detail__free" rows="2" placeholder="왜 저장했는지 한 줄" style="display:${freeMode ? "block" : "none"}">${freeMode ? esc(why ?? "") : ""}</textarea>
      </div>

      <div class="card">
        <div class="card__h">메모</div>
        <textarea class="field detail__memo" rows="3" placeholder="메모 (선택)">${esc(cap.memo ?? "")}</textarea>
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

    const free = root.querySelector(".detail__free") as HTMLTextAreaElement;
    const memo = root.querySelector(".detail__memo") as HTMLTextAreaElement;
    const pageEl = root.querySelector(".detail__page") as HTMLInputElement;
    const writeChip = root.querySelector(".chip--write") as HTMLElement;
    const chipEls = Array.from(root.querySelectorAll(".chip[data-why]")) as HTMLElement[];
    const tagEls = Array.from(root.querySelectorAll(".tagpill")) as HTMLElement[];

    tagEls.forEach((el) => {
      el.onclick = () => {
        tag = el.dataset.tag as Tag;
        tagEls.forEach((x) => x.classList.toggle("is-sel", x === el));
      };
    });

    chipEls.forEach((el) => {
      el.onclick = () => {
        const v = el.dataset.why!;
        const already = el.classList.contains("is-sel");
        chipEls.forEach((c) => c.classList.remove("is-sel"));
        writeChip.classList.remove("is-sel");
        free.style.display = "none";
        freeMode = false;
        if (already) {
          why = null;
        } else {
          el.classList.add("is-sel");
          why = v;
        }
      };
    });
    writeChip.onclick = () => {
      chipEls.forEach((c) => c.classList.remove("is-sel"));
      writeChip.classList.add("is-sel");
      free.style.display = "block";
      free.focus();
      freeMode = true;
    };

    (root.querySelector(".save") as HTMLButtonElement).onclick = async () => {
      const memoVal = memo.value.trim() || null;
      const whyVal = freeMode ? free.value.trim() || null : why;
      const n = parseInt(pageEl.value, 10);
      const page = Number.isFinite(n) && n > 0 ? n : undefined;

      if (!isValidCapture({ image: cap.image, memo: memoVal, tag })) {
        alert("사진이나 메모 중 하나는 있어야 해요.");
        return;
      }
      await updateCapture({ ...cap, tag, why: whyVal, memo: memoVal, page, updatedAt: Date.now() });
      back();
    };
  }

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
