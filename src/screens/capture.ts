/**
 * Capture 루프 — PRD §7-B / §16.
 * 사진 모드: 셔터(동결) → 태그(필수) → 내 생각(선택) → 저장 → 즉시 카메라 복귀.
 * 입력 모드: passage(필수) + note(선택) + page(선택) + 태그(필수) → 저장 → 초기화.
 * 예산 계측: 웜업 / appMs / humanMs / 압축 / 용량 — HUD 노출 (사진 모드만).
 */
import type { Nav } from "../app.ts";
import { startCamera, stopCamera } from "../camera/camera.ts";
import { grabFrame, resizeCompress } from "../lib/image.ts";
import { BUDGET, Stopwatch, record, within } from "../lib/budget.ts";
import { addCapture, countCaptures, getBook, getSession, uuid } from "../db/db.ts";
import { TAGS, isValidCapture, type Capture, type Session, type Tag } from "../db/types.ts";

type Phase = "live" | "tagging" | "note";
type Mode = "photo" | "input";

export function mountCapture(
  root: HTMLElement,
  nav: Nav,
  sessionId: string,
  initialMode: Mode = "photo",
): () => void {
  root.innerHTML = `<div class="cam"><div class="cam__boot">준비 중…</div></div>`;

  (async () => {
    const session = await getSession(sessionId);
    if (!session) {
      nav({ name: "home" });
      return;
    }
    const book = await getBook(session.bookId);
    const startCount = await countCaptures(sessionId);
    run(session, book?.title ?? "(책)", startCount);
  })();

  function run(session: Session, bookTitle: string, startCount: number) {
    root.innerHTML = template(session, bookTitle, startCount, initialMode);

    // ---- Common elements ----
    const cam = root.querySelector(".cam") as HTMLElement;
    const cntEl = root.querySelector(".cnt") as HTMLElement;
    const done = root.querySelector(".done") as HTMLElement;

    // ---- Mode toggle ----
    const modeBtnPhoto = root.querySelector(".mode-btn--photo") as HTMLButtonElement;
    const modeBtnInput = root.querySelector(".mode-btn--input") as HTMLButtonElement;

    // ---- Photo mode elements ----
    const video = root.querySelector(".cam__video") as HTMLVideoElement;
    const freeze = root.querySelector(".cam__freeze") as HTMLImageElement;
    const hint = root.querySelector(".hint") as HTMLElement;
    const shutter = root.querySelector(".shutter") as HTMLButtonElement;
    const photoCtrl = root.querySelector(".photo-ctrl") as HTMLElement;
    const tagEls = Array.from(photoCtrl.querySelectorAll(".tag")) as HTMLElement[];
    const scrim = root.querySelector(".sheet-scrim") as HTMLElement;
    const sheet = root.querySelector(".sheet") as HTMLElement;
    const sheetTag = root.querySelector(".sheet__tag") as HTMLElement;
    const free = root.querySelector(".sheet__free") as HTMLTextAreaElement;
    const pageInput = root.querySelector(".sheet__page") as HTMLInputElement;
    const saveBtn = root.querySelector(".btn-save") as HTMLButtonElement;
    const hud = root.querySelector(".hud") as HTMLElement;

    // ---- Input mode elements ----
    const inpPassage = root.querySelector(".inp__passage") as HTMLTextAreaElement;
    const inpNote = root.querySelector(".inp__note") as HTMLTextAreaElement;
    const inpPage = root.querySelector(".inp__page") as HTMLInputElement;
    const inpTagEls = Array.from(root.querySelectorAll(".inp__tagrow .tag")) as HTMLElement[];
    const inpSaveBtn = root.querySelector(".inp__save") as HTMLButtonElement;
    const inpHint = root.querySelector(".inp__hint") as HTMLElement;
    inpPassage.oninput = () => inpPassage.classList.remove("field--err");

    (root.querySelector(".cam__back") as HTMLElement).onclick = () => nav({ name: "home" });
    cntEl.onclick = () => nav({ name: "review", scope: "session", id: session.uuid });

    // ---- Photo mode state ----
    let phase: Phase = "live";
    let frame: ImageBitmap | null = null;
    let freezeUrl: string | null = null;
    let chosenTag: Tag | null = null;
    let count = startCount;
    let shutterMs = 0;
    const captureSw = new Stopwatch();

    // ---- Input mode state ----
    let inpChosenTag: Tag | null = null;

    // ---- Current mode ----
    let currentMode: Mode = initialMode;

    // ---- HUD helpers ----
    const hudChip = (label: string, ms: number, budget?: number) => {
      const cls = budget == null ? "" : within(ms, budget) ? "ok" : "over";
      return `<span class="hud__chip ${cls}">${label} ${Math.round(ms)}${
        budget ? "/" + budget : ""
      }ms</span>`;
    };
    const sizeChip = (kb: number) =>
      `<span class="hud__chip ${kb <= 500 ? "ok" : "over"}">img ${Math.round(kb)}KB</span>`;

    // ---- Camera startup (photo mode only) ----
    async function startCam() {
      hint.textContent = "카메라 준비 중…";
      hud.innerHTML = "";
      try {
        const { warmupMs } = await startCamera(video);
        hud.innerHTML = hudChip("warmup", warmupMs, BUDGET.warmupMs);
        hint.textContent = "책 페이지를 담고 셔터를 누르세요";
      } catch (e) {
        hint.textContent = "카메라를 열 수 없어요. 권한을 확인해 주세요.";
        hud.innerHTML = `<span class="hud__chip over">camera: ${(e as Error).name}</span>`;
      }
    }

    // ---- Mode switching ----
    async function setMode(m: Mode) {
      if (m === currentMode) return;
      currentMode = m;

      if (m === "input") {
        // Stop camera when switching to input mode
        stopCamera();
        cam.classList.add("mode--input");
        modeBtnPhoto.classList.remove("is-active");
        modeBtnInput.classList.add("is-active");
        // Reset photo state if mid-capture
        if (phase !== "live") resetToLive();
        inpPassage.focus();
      } else {
        // Switch to photo mode: start camera
        cam.classList.remove("mode--input");
        modeBtnPhoto.classList.add("is-active");
        modeBtnInput.classList.remove("is-active");
        // Reset input state
        inpPassage.value = "";
        inpNote.value = "";
        inpPage.value = "";
        inpChosenTag = null;
        inpTagEls.forEach((t) => t.classList.remove("is-sel"));
        inpHint.classList.remove("inp__hint--err");
        inpPassage.classList.remove("field--err");
        await startCam();
      }
    }

    modeBtnPhoto.onclick = () => setMode("photo");
    modeBtnInput.onclick = () => setMode("input");

    // ---- Initial camera startup (photo mode only) ----
    if (initialMode === "photo") {
      startCam();
    }

    // ---- Shutter: freeze frame + capture stopwatch start ----
    shutter.onclick = async () => {
      if (phase !== "live") return;
      captureSw.reset();
      const shutterSw = new Stopwatch();
      try {
        frame = await grabFrame(video);
      } catch {
        frame = null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      canvas.toBlob(
        (b) => {
          if (b) {
            freezeUrl = URL.createObjectURL(b);
            freeze.src = freezeUrl;
          }
          shutterMs = shutterSw.stop();
        },
        "image/jpeg",
        0.6,
      );

      cam.classList.add("is-frozen");
      phase = "tagging";
      hint.textContent = "한 가지 태그를 고르세요";
    };

    // ---- Photo mode: tag selection → note sheet ----
    tagEls.forEach((el) => {
      el.onclick = () => {
        if (phase !== "tagging") return;
        chosenTag = el.dataset.tag as Tag;
        tagEls.forEach((t) => t.classList.toggle("is-sel", t === el));
        const meta = TAGS.find((t) => t.key === chosenTag)!;
        sheetTag.textContent = `${meta.emoji} ${meta.label}`;
        openSheet();
      };
    });

    function openSheet() {
      phase = "note";
      scrim.classList.add("is-open");
      sheet.classList.add("is-open");
    }
    function closeSheet() {
      scrim.classList.remove("is-open");
      sheet.classList.remove("is-open");
    }

    scrim.onclick = closeSheet;

    // ---- Photo mode: save ----
    saveBtn.onclick = async () => {
      if (!chosenTag) return;
      const saveSw = new Stopwatch();
      const memoVal = free.value.trim() || null;

      const rec: Capture = {
        uuid: uuid(),
        sessionId: session.uuid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        image: null,
        passage: null,
        memo: memoVal,
        tag: chosenTag,
        why: null,
        ocr: null,
        exportStatus: "none",
      };

      const pageNum = parseInt(pageInput.value, 10);
      if (Number.isFinite(pageNum) && pageNum > 0) rec.page = pageNum;

      if (!frame && !memoVal) return;
      await addCapture(rec);
      const captureMs = captureSw.stop();
      count += 1;
      cntEl.textContent = `📍 ${count} ›`;

      closeSheet();
      showDone();
      resetToLive();

      const appMs = shutterMs + saveSw.stop();
      const humanMs = Math.max(0, captureMs - appMs);

      let compressMs = 0;
      let sizeKB = 0;
      if (frame) {
        const compSw = new Stopwatch();
        try {
          const { blob, width, height } = await resizeCompress(frame);
          compressMs = compSw.stop();
          sizeKB = blob.size / 1024;
          rec.image = blob;
          rec.imageW = width;
          rec.imageH = height;
          rec.updatedAt = Date.now();
          await addCapture(rec);
        } catch {
          /* 이미지 실패해도 메타 캡처는 유효 */
        }
        frame.close?.();
        frame = null;
      }

      record({ captureMs, appMs, humanMs, compressMs, sizeKB });
      renderHud({ appMs, humanMs, compressMs, sizeKB });
    };

    // ---- Input mode: tag selection ----
    inpTagEls.forEach((el) => {
      el.onclick = () => {
        inpChosenTag = el.dataset.tag as Tag;
        inpTagEls.forEach((t) => t.classList.toggle("is-sel", t === el));
        inpHint.classList.remove("inp__hint--err");
      };
    });

    // ---- Input mode: save ----
    inpSaveBtn.onclick = async () => {
      const passageVal = inpPassage.value.trim() || null;
      const noteVal = inpNote.value.trim() || null;

      // Validate: passage is required in input mode (no image)
      if (!passageVal) {
        inpPassage.focus();
        inpPassage.classList.add("field--err");
        return;
      }
      if (!inpChosenTag) {
        inpHint.classList.add("inp__hint--err");
        inpHint.textContent = "태그를 골라야 저장할 수 있어요";
        return;
      }
      // Sanity check via domain validator
      if (!isValidCapture({ image: null, passage: passageVal, memo: noteVal, tag: inpChosenTag })) {
        return;
      }

      const rec: Capture = {
        uuid: uuid(),
        sessionId: session.uuid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        image: null,
        passage: passageVal,
        memo: noteVal,
        tag: inpChosenTag,
        why: null,
        ocr: null,
        exportStatus: "none",
      };

      const pageNum = parseInt(inpPage.value, 10);
      if (Number.isFinite(pageNum) && pageNum > 0) rec.page = pageNum;

      await addCapture(rec);
      count += 1;
      cntEl.textContent = `📍 ${count} ›`;

      // Reset for next entry — stay in input mode
      inpPassage.value = "";
      inpNote.value = "";
      inpPage.value = "";
      inpChosenTag = null;
      inpTagEls.forEach((t) => t.classList.remove("is-sel"));
      inpHint.classList.remove("inp__hint--err");
      inpHint.textContent = "한 가지 태그를 고르세요";
      inpPassage.classList.remove("field--err");
      inpPassage.focus();

      showDone();
    };

    function renderHud(m: { appMs: number; humanMs: number; compressMs: number; sizeKB: number }) {
      const warmup = hud.querySelector(".hud__chip")?.outerHTML ?? "";
      hud.innerHTML =
        warmup +
        hudChip("app", m.appMs, BUDGET.appMs) +
        `<span class="hud__chip">사람 ${Math.round(m.humanMs)}ms</span>` +
        hudChip("compress", m.compressMs) +
        (m.sizeKB ? sizeChip(m.sizeKB) : "");
    }

    function showDone() {
      navigator.vibrate?.(30);
      done.classList.remove("is-show");
      void done.offsetWidth;
      done.classList.add("is-show");
    }

    function resetToLive() {
      phase = "live";
      chosenTag = null;
      cam.classList.remove("is-frozen");
      tagEls.forEach((t) => t.classList.remove("is-sel"));
      free.value = "";
      pageInput.value = "";
      hint.textContent = "책 페이지를 담고 셔터를 누르세요";
      if (freezeUrl) {
        URL.revokeObjectURL(freezeUrl);
        freezeUrl = null;
      }
    }
  }

  // Cleanup: always stop camera (safe even if camera was never started)
  return () => stopCamera();
}

function template(session: Session, bookTitle: string, startCount: number, initialMode: Mode) {
  const tags = TAGS.map(
    (t) =>
      `<button class="tag" data-tag="${t.key}" aria-label="${t.label}">${t.emoji}<span class="tag__l">${t.label}</span></button>`,
  ).join("");
  const project = session.project ? `<span class="sep">·</span> 🎯 ${esc(session.project)}` : "";
  const isInput = initialMode === "input";

  return `
  <div class="cam${isInput ? " mode--input" : ""}">
    <video class="cam__video" playsinline muted></video>
    <img class="cam__freeze" alt="" />
    <div class="cam__scrim"></div>

    <div class="pill">
      <button class="cam__back" aria-label="홈">‹</button>
      <span class="pill__title">📚 ${esc(bookTitle)} ${project}</span>
      <div class="mode-toggle">
        <button class="mode-btn mode-btn--photo${!isInput ? " is-active" : ""}" aria-label="사진 모드">📷 사진</button>
        <button class="mode-btn mode-btn--input${isInput ? " is-active" : ""}" aria-label="입력 모드">✍️ 입력</button>
      </div>
      <button class="cnt" aria-label="리뷰">📍 ${startCount} ›</button>
    </div>

    <div class="hud"></div>

    <div class="photo-ctrl bottom">
      <div class="hint">카메라 준비 중…</div>
      <div class="tagrow">${tags}</div>
      <div class="shutter-wrap"><button class="shutter" aria-label="촬영"></button></div>
    </div>

    <div class="input-panel">
      <div class="input-panel__inner">
        <label class="inp__label">담고 싶은 글</label>
        <textarea class="field inp__passage" rows="6" placeholder="담고 싶은 글 (필수)"></textarea>
        <label class="inp__label">내 생각 (선택)</label>
        <textarea class="field inp__note" rows="2" placeholder="내 생각·메모 (선택)"></textarea>
        <input class="field inp__page" type="number" inputmode="numeric" min="1" placeholder="페이지 (선택)" />
        <div class="inp__hint">한 가지 태그를 고르세요</div>
        <div class="tagrow inp__tagrow">${tags}</div>
        <button class="btn-primary inp__save">저장</button>
      </div>
    </div>

    <div class="sheet-scrim"></div>
    <div class="sheet">
      <div class="grab"></div>
      <div class="sheet__tag">⭐ 중요하다</div>
      <h2>내 생각 (선택)</h2>
      <textarea class="sheet__free" rows="2" placeholder="내 생각·메모 (선택)"></textarea>
      <input class="sheet__page" type="number" inputmode="numeric" min="1" placeholder="페이지(선택)" />
      <button class="btn-primary btn-save">저장</button>
    </div>

    <div class="done"><div class="done__badge">✓</div></div>
  </div>`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
