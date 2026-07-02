/** 캡처 상세 + 편집 — 큰 사진 + 태그/왜/메모/페이지 수정. PRD §8, ADR-004. */
import type { Nav, Scope } from "../app.ts";
import { currentRoundFor, getBook, getCapture, getSession, updateCapture } from "../db/db.ts";
import { TAGS, isValidCapture, type Book, type Capture, type Tag } from "../db/types.ts";
import { openBookPicker } from "../lib/bookpicker.ts";
import { openImageViewer } from "../lib/viewer.ts";

export function mountDetail(
  root: HTMLElement,
  nav: Nav,
  captureId: string,
  from: { scope: Scope; id: string },
): () => void {
  const urls: string[] = [];
  root.innerHTML = `<div class="scr scr--light"><div class="loading">불러오는 중…</div></div>`;

  // back은 진입한 from 유지 — 책을 바꾼 뒤엔 옛 Review에 이 캡처가 없을 수 있음(의도된 수용).
  const back = () => nav({ name: "review", scope: from.scope, id: from.id });

  (async () => {
    const cap = await getCapture(captureId);
    if (!cap) return back();
    const session = await getSession(cap.sessionId);
    const book = session ? await getBook(session.bookId) : null;
    render(cap, book ?? null);
  })();

  function render(cap: Capture, initialBook: Book | null) {
    let book: Book | null = initialBook;
    let tag: Tag = cap.tag;
    let lastCropUrl: string | null = null;

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

      ${cap.image ? `<img class="detail__photoimg" alt="" />` : `<div class="detail__photo--none">📝</div>`}

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

      <div class="card detail__bookrow">
        <span class="detail__book">📚 ${esc(book?.title ?? "(책)")}</span>
        <button class="btn-ghost bookchange">책 바꾸기</button>
      </div>

      <div class="detail__stamp">${stamp}</div>

      <button class="btn-primary save">저장</button>
      <div class="toast" hidden></div>
    </div>`;

    if (cap.image) {
      const photoEl = root.querySelector(".detail__photoimg") as HTMLImageElement;
      const u = URL.createObjectURL(cap.image);
      urls.push(u);
      photoEl.src = u;
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
            // 상세 썸네일 갱신 — 이전 크롭 URL만 revoke (초기 썸네일은 건드리지 않음)
            const u = URL.createObjectURL(blob);
            if (lastCropUrl) URL.revokeObjectURL(lastCropUrl);
            lastCropUrl = u;
            urls.push(u);
            photoEl.src = u;
          },
        });
      };
    }

    (root.querySelector(".back") as HTMLElement).onclick = back;

    const flash = (msg: string) => {
      const toast = root.querySelector(".toast") as HTMLElement | null;
      if (!toast) return; // 화면 이탈 후 늦은 응답 — 무시
      toast.textContent = msg;
      toast.hidden = false;
      setTimeout(() => (toast.hidden = true), 2400);
    };

    // 책 바꾸기 — 캡처를 선택한 책의 현재 회독으로 이동
    const bookNameEl = root.querySelector(".detail__book") as HTMLElement;
    (root.querySelector(".bookchange") as HTMLButtonElement).onclick = () =>
      openBookPicker({
        currentBookId: book?.uuid,
        onPick: async (b) => {
          cap.sessionId = await currentRoundFor(b.uuid);
          cap.updatedAt = Date.now();
          await updateCapture(cap);
          book = b; // 로컬 갱신 — 이후 저장 스프레드에도 새 sessionId 반영됨
          bookNameEl.textContent = `📚 ${b.title}`;
          flash(`『${b.title}』(으)로 옮겼어요`);
        },
      });

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
