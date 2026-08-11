/** 캡처 상세 + 편집 — 큰 사진 + 태그/왜/메모/페이지 수정. PRD §8, ADR-004. */
import type { Nav, Scope } from "../app.ts";
import { escapeHtml as esc, formatTime, showToast } from "../lib/ui.ts";
import { currentRoundFor, getBook, getCapture, getSession, updateCapture } from "../db/db.ts";
import {
  MAX_PHOTOS,
  TAGS,
  capturePhotos,
  isValidCapture,
  photoSlots,
  type Book,
  type Capture,
  type Photo,
  type Tag,
} from "../db/types.ts";
import { openBookPicker } from "../lib/bookpicker.ts";
import { openImageViewer } from "../lib/viewer.ts";
import { compressImageFile } from "../lib/image.ts";

export function mountDetail(
  root: HTMLElement,
  nav: Nav,
  captureId: string,
  from: { scope: Scope; id: string },
): () => void {
  let photoUrls: string[] = []; // 사진 스트립 objectURL — 렌더마다 교체, cleanup에서 revoke
  let backTimer: number | null = null; // 저장 후 지연 back 타이머 — cleanup에서 해제
  let closeOverlay: (() => void) | null = null; // 열린 뷰어/책피커 닫기 핸들 — cleanup에서 잔류 방지
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

    const tagPills = TAGS.map(
      (t) =>
        `<button class="tagpill ${t.key === tag ? "is-sel" : ""}" data-tag="${t.key}">${t.emoji} ${t.label}</button>`,
    ).join("");

    const stamp = formatTime(cap.createdAt, "date");

    root.innerHTML = `
    <div class="scr scr--light detail">
      <div class="topbar">
        <button class="iconbtn back" aria-label="뒤로">‹</button>
        <div class="topbar__t">캡처</div>
      </div>

      <div class="detail__photos">
        <div class="detail__strip"></div>
        <button class="btn-ghost detail__addphoto" hidden>사진 추가</button>
        <input class="detail__file" type="file" accept="image/*" hidden />
      </div>

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

    (root.querySelector(".back") as HTMLElement).onclick = back;

    const flash = (msg: string) => {
      // 화면 이탈 후 늦은 응답 — 무시(root가 다시 렌더된 뒤 stray 토스트 방지)
      if (!root.querySelector(".toast")) return;
      showToast(root, msg, 2400);
    };

    // 책 바꾸기 — 캡처를 선택한 책의 현재 회독으로 이동
    const bookNameEl = root.querySelector(".detail__book") as HTMLElement;
    (root.querySelector(".bookchange") as HTMLButtonElement).onclick = () =>
      (closeOverlay = openBookPicker({
        currentBookId: book?.uuid,
        onPick: async (b) => {
          cap.sessionId = await currentRoundFor(b.uuid);
          cap.updatedAt = Date.now();
          await updateCapture(cap);
          book = b; // 로컬 갱신 — 이후 저장 스프레드에도 새 sessionId 반영됨
          bookNameEl.textContent = `📚 ${b.title}`;
          flash(`『${b.title}』(으)로 옮겼어요`);
        },
      }));

    const passageEl = root.querySelector(".detail__passage") as HTMLTextAreaElement;
    const memo = root.querySelector(".detail__memo") as HTMLTextAreaElement;
    const pageEl = root.querySelector(".detail__page") as HTMLInputElement;
    const tagEls = Array.from(root.querySelectorAll(".tagpill")) as HTMLElement[];
    passageEl.oninput = () => passageEl.classList.remove("field--err");
    memo.oninput = () => memo.classList.remove("field--err");

    tagEls.forEach((el) => {
      el.onclick = () => {
        tag = el.dataset.tag as Tag;
        tagEls.forEach((x) => x.classList.toggle("is-sel", x === el));
      };
    });

    // ---- 사진(최대 2장, ADR-020) — 재크롭·삭제·추가는 저장 버튼을 기다리지 않고 즉시 반영 ----
    const stripEl = root.querySelector(".detail__strip") as HTMLElement;
    const addPhotoBtn = root.querySelector(".detail__addphoto") as HTMLButtonElement;
    const fileEl = root.querySelector(".detail__file") as HTMLInputElement;

    async function persistPhotos(shots: Photo[]) {
      Object.assign(cap, photoSlots(shots), { updatedAt: Date.now() });
      await updateCapture(cap);
      renderPhotos();
    }

    function renderPhotos() {
      photoUrls.forEach((u) => URL.revokeObjectURL(u));
      photoUrls = [];
      stripEl.innerHTML = "";
      const shots = capturePhotos(cap);
      if (!shots.length) {
        const none = document.createElement("div");
        none.className = "detail__photo--none";
        none.textContent = "📝";
        stripEl.append(none);
      }
      shots.forEach((p, i) => {
        const u = URL.createObjectURL(p.blob);
        photoUrls.push(u);
        const slot = document.createElement("div");
        slot.className = "detail__slot";
        const img = document.createElement("img");
        img.className = "detail__photoimg";
        img.alt = "";
        img.src = u;
        img.title = "탭하면 확대";
        img.setAttribute("aria-label", `사진 ${i + 1} — 탭하면 확대`);
        img.onclick = () => {
          closeOverlay = openImageViewer(p.blob, {
            onCrop: async (blob, w, h) => {
              const next = capturePhotos(cap);
              next[i] = { blob, width: w, height: h };
              await persistPhotos(next);
            },
          });
        };
        const del = document.createElement("button");
        del.className = "detail__del";
        del.type = "button";
        del.setAttribute("aria-label", `사진 ${i + 1} 삭제`);
        del.textContent = "×";
        del.onclick = async () => {
          const rest = capturePhotos(cap).filter((_, j) => j !== i);
          // 사진을 지워 내용이 하나도 남지 않는 캡처는 만들지 않는다(ADR-014)
          const draft = {
            ...photoSlots(rest),
            passage: passageEl.value.trim() || null,
            memo: memo.value.trim() || null,
            tag,
          };
          if (!isValidCapture(draft)) {
            flash("담은 글이나 내 생각, 사진 중 하나는 필요해요");
            return;
          }
          await persistPhotos(rest);
        };
        slot.append(img, del);
        stripEl.append(slot);
      });
      stripEl.classList.toggle("detail__strip--two", shots.length > 1);
      addPhotoBtn.hidden = shots.length >= MAX_PHOTOS;
    }

    // 상세 화면엔 카메라가 없다 — 파일 입력으로 iOS 네이티브 "사진 찍기 / 보관함" 시트를 띄운다
    addPhotoBtn.onclick = () => fileEl.click();
    fileEl.onchange = async () => {
      const f = fileEl.files?.[0];
      fileEl.value = ""; // 같은 파일을 다시 고를 수 있게
      if (!f) return;
      const shots = capturePhotos(cap);
      if (shots.length >= MAX_PHOTOS) return;
      addPhotoBtn.disabled = true;
      try {
        const { blob, width, height } = await compressImageFile(f);
        await persistPhotos([...shots, { blob, width, height }]);
        flash("사진을 추가했어요");
      } catch {
        flash("사진을 불러오지 못했어요");
      } finally {
        addPhotoBtn.disabled = false;
      }
    };

    renderPhotos();

    const saveBtn = root.querySelector(".save") as HTMLButtonElement;
    saveBtn.onclick = async () => {
      const passageVal = passageEl.value.trim() || null;
      const memoVal = memo.value.trim() || null;
      const n = parseInt(pageEl.value, 10);
      const page = Number.isFinite(n) && n > 0 ? n : undefined;
      if (!isValidCapture({ ...cap, passage: passageVal, memo: memoVal, tag })) {
        // capture 패턴과 통일 — 내용 필드 표시 + 토스트(alert 금지)
        passageEl.focus();
        passageEl.classList.add("field--err");
        memo.classList.add("field--err");
        flash("담은 글이나 내 생각, 사진 중 하나는 필요해요");
        return;
      }
      saveBtn.disabled = true; // 지연 back 동안 재저장 방지
      await updateCapture({ ...cap, tag, passage: passageVal, memo: memoVal, why: null, page, updatedAt: Date.now() });
      flash("저장했어요");
      backTimer = window.setTimeout(back, 900); // 토스트가 보이도록 잠깐 머문 뒤 복귀
    };
  }

  return () => {
    if (backTimer != null) clearTimeout(backTimer); // 이탈 후 지연 back이 사용자를 끌고가지 않게
    closeOverlay?.(); // 열린 뷰어/책피커 정리(idempotent)
    closeOverlay = null;
    photoUrls.forEach((u) => URL.revokeObjectURL(u));
    photoUrls = [];
  };
}

