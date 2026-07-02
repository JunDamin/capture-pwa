/**
 * Capture 루프 — PRD §7-B / §16, ADR-018.
 * 사진 모드: 셔터(크롭·압축 킥오프, 스냅샷 의미론) → 편집 시트 상승(사진 확인·다시 찍기·태그·담은 글·생각·페이지)
 *   → 저장(단일 addCapture) → 시트 하강, 라이브 복귀. 카메라는 시트 아래에서 계속 라이브.
 * 입력 모드: passage 또는 note ≥1 + page(선택) + 태그(필수) → 저장 → 초기화.
 * 예산 계측: 웜업 / appMs(shutterMs+saveMs) / humanMs / 압축 / 용량 — HUD 노출 (사진 모드만).
 */
import type { Nav } from "../app.ts";
import { startCamera, stopCamera } from "../camera/camera.ts";
import { cropResizeCompress } from "../lib/image.ts";
import { mountCropFrame, type CropFrame } from "../lib/cropframe.ts";
import { BUDGET, Stopwatch, record, within } from "../lib/budget.ts";
import { addCapture, countCaptures, currentRoundFor, getBook, getSession, uuid } from "../db/db.ts";
import { TAGS, isValidCapture, type Capture, type Session, type Tag } from "../db/types.ts";
import { consumeSharedText } from "../lib/install.ts";
import { openBookPicker } from "../lib/bookpicker.ts";
import { openImageViewer } from "../lib/viewer.ts";

type Phase = "live" | "editing";
type Mode = "photo" | "input";

interface PendingPhoto {
  blob: Blob;
  width: number;
  height: number;
  compressMs: number;
}

export function mountCapture(
  root: HTMLElement,
  nav: Nav,
  sessionId: string,
  initialMode: Mode = "photo",
): () => void {
  root.innerHTML = `<div class="cam"><div class="cam__boot">준비 중…</div></div>`;

  let cropFrame: CropFrame | null = null;
  let pendingUrl: string | null = null; // 편집 시트 사진 objectURL — cleanup에서도 revoke

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
    const hint = root.querySelector(".hint") as HTMLElement;
    const shutter = root.querySelector(".shutter") as HTMLButtonElement;
    const hud = root.querySelector(".hud") as HTMLElement;

    // ---- Editor sheet elements (촬영 후 편집 시트) ----
    const edsheet = root.querySelector(".edsheet") as HTMLElement;
    const edImg = root.querySelector(".ed__photoimg") as HTMLImageElement;
    const edPh = root.querySelector(".ed__photoph") as HTMLElement;
    const edRetake = root.querySelector(".ed__retake") as HTMLButtonElement;
    const edHint = root.querySelector(".ed__hint") as HTMLElement;
    const edPassage = root.querySelector(".ed__passage") as HTMLTextAreaElement;
    const edNote = root.querySelector(".ed__note") as HTMLTextAreaElement;
    const edPage = root.querySelector(".ed__page") as HTMLInputElement;
    const edSave = root.querySelector(".ed__save") as HTMLButtonElement;
    edPassage.oninput = () => edPassage.classList.remove("field--err");
    edNote.oninput = () => edNote.classList.remove("field--err");

    // ---- Input mode elements ----
    const inpPassage = root.querySelector(".inp__passage") as HTMLTextAreaElement;
    const inpNote = root.querySelector(".inp__note") as HTMLTextAreaElement;
    const inpPage = root.querySelector(".inp__page") as HTMLInputElement;
    const inpSaveBtn = root.querySelector(".inp__save") as HTMLButtonElement;
    const inpHint = root.querySelector(".inp__hint:not(.ed__hint)") as HTMLElement;
    inpPassage.oninput = () => inpPassage.classList.remove("field--err");
    inpNote.oninput = () => inpNote.classList.remove("field--err");

    // 공유 수신 텍스트 — 입력모드 시 passage 프리필(1회성)
    if (initialMode === "input") {
      const shared = consumeSharedText();
      if (shared) inpPassage.value = shared;
    }

    (root.querySelector(".cam__back") as HTMLElement).onclick = () => {
      if (phase === "editing") return; // 시트 열림 중 상단 틈 탭 차단
      nav({ name: "home" });
    };
    cntEl.onclick = () => {
      if (phase === "editing") return;
      nav({ name: "review", scope: "session", id: session.uuid });
    };

    // ---- Photo mode state ----
    let phase: Phase = "live";
    let count = startCount;
    let shutterMs = 0;
    let shotSeq = 0; // 다시 찍기/초기화 이후 늦게 도착한 압축 결과 폐기용
    let pendingPhoto: PendingPhoto | null = null;
    let edChosenTag: Tag | null = null;
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
      cropFrame?.destroy();
      cropFrame = null;
      try {
        const { warmupMs } = await startCamera(video);
        cropFrame = mountCropFrame(cam);
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
        inpNote.classList.remove("field--err");
        await startCam();
      }
    }

    modeBtnPhoto.onclick = () => {
      if (phase === "editing") return;
      setMode("photo");
    };
    modeBtnInput.onclick = () => {
      if (phase === "editing") return;
      setMode("input");
    };

    // ---- 책 전환 (pill 탭) — 입력 모드에서만 동작(런타임 가드) ----
    const pillTitle = root.querySelector(".pill__title") as HTMLElement;
    pillTitle.onclick = () => {
      if (currentMode !== "input") return; // 사진 모드 불변(3초 루프)
      openBookPicker({
        currentBookId: session.bookId,
        onPick: async (book) => {
          const sid = await currentRoundFor(book.uuid);
          session = (await getSession(sid))!;
          // pill 전체 재렌더 — 제목 + 회독 목적 칩(이전 칩 잔류 방지). 입력 필드는 유지.
          const proj = session.project
            ? `<span class="sep">·</span> 🎯 ${esc(session.project)}`
            : "";
          pillTitle.innerHTML = `📚 ${esc(book.title)} ${proj}`;
          count = await countCaptures(session.uuid);
          cntEl.textContent = `📍 ${count} ›`;
        },
      });
    };

    // ---- Initial camera startup (photo mode only) ----
    if (initialMode === "photo") {
      consumeSharedText(); // 잔류 클리어 — 사진 모드 진입 시 버림
      startCam();
    }

    // ---- 셔터 시점 cover 매핑 — 뷰파인더 좌표 → 소스 픽셀 (스냅샷 의미론, ADR-018) ----
    function computeCropPx(canvas: HTMLCanvasElement) {
      const vW = canvas.width;
      const vH = canvas.height;
      const elW = cam.clientWidth || vW;
      const elH = cam.clientHeight || vH;
      const r = cropFrame ? cropFrame.getRect() : { x: 0, y: 0, w: 1, h: 1 };
      if (vW > 0 && vH > 0) {
        const scale = Math.max(elW / vW, elH / vH);
        const offX = (vW * scale - elW) / 2;
        const offY = (vH * scale - elH) / 2;
        return {
          sx: (r.x * elW + offX) / scale,
          sy: (r.y * elH + offY) / scale,
          sw: (r.w * elW) / scale,
          sh: (r.h * elH) / scale,
        };
      }
      return { sx: 0, sy: 0, sw: vW, sh: vH };
    }

    // ---- Shutter: 크롭·압축 킥오프 + 편집 시트 상승 ----
    shutter.onclick = () => {
      if (phase !== "live") return;
      captureSw.reset();
      const shutterSw = new Stopwatch();
      // 1) 소스 캔버스 + 셔터 시점 크롭 확정(동기)
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const cropPx = computeCropPx(canvas);
      // 2) 압축 킥오프(비동기 — 시트 상승 애니메이션과 병행)
      const seq = ++shotSeq;
      const compSw = new Stopwatch();
      void cropResizeCompress(canvas, canvas.width, canvas.height, cropPx)
        .then(({ blob, width, height }) => {
          canvas.width = 0;
          canvas.height = 0; // iOS 캔버스 메모리 즉시 해제(CLAUDE.md)
          if (seq !== shotSeq) return; // 다시 찍기/저장 뒤 늦게 도착 — 폐기
          pendingPhoto = { blob, width, height, compressMs: compSw.stop() };
          if (phase === "editing") setEditorPhoto(blob); // 늦게 도착해도 시트에 반영
        })
        .catch(() => {
          canvas.width = 0;
          canvas.height = 0; // 무사진 강등 — placeholder 유지, 검증은 저장 시 pendingPhoto 기준
        });
      // 3) 시트 상승(동기)
      openEditor();
      shutterMs = shutterSw.stop(); // 셔터 탭 → 시트 상승 시작까지(동기 구간)
    };

    // ---- Editor sheet: photo / open / close ----
    function setEditorPhoto(blob: Blob) {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      pendingUrl = URL.createObjectURL(blob);
      edImg.src = pendingUrl;
      edImg.hidden = false;
      edPh.hidden = true;
    }

    function clearEditorPhoto() {
      shotSeq += 1; // 진행 중 압축 결과 무효화
      pendingPhoto = null;
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl);
        pendingUrl = null;
      }
      edImg.hidden = true;
      edImg.removeAttribute("src");
      edPh.hidden = false;
    }

    function openEditor() {
      phase = "editing";
      cam.classList.add("is-editing");
      edsheet.classList.add("is-open");
    }

    function closeEditor(reset: boolean) {
      edsheet.classList.remove("is-open");
      cam.classList.remove("is-editing");
      phase = "live";
      if (reset) {
        edPassage.value = "";
        edNote.value = "";
        edPage.value = "";
        edChosenTag = null;
        edTagEls.forEach((t) => t.classList.remove("is-sel"));
        edHint.classList.remove("inp__hint--err");
        edHint.textContent = "한 가지 태그를 고르세요";
        edPassage.classList.remove("field--err");
        edNote.classList.remove("field--err");
        clearEditorPhoto();
      }
    }

    // 다시 찍기 = 사진만 폐기 — 입력 텍스트·태그는 보존(다음 셔터에서 시트 재개)
    edRetake.onclick = () => {
      clearEditorPhoto();
      closeEditor(false);
    };

    // 사진 탭 → 전체화면 뷰어(재크롭) — detail.ts와 동일 패턴, 뷰어는 body 부착(z1000, 시트 위)
    edImg.onclick = () => {
      if (!pendingPhoto) return;
      openImageViewer(pendingPhoto.blob, {
        onCrop: (blob, w, h) => {
          pendingPhoto = { ...pendingPhoto!, blob, width: w, height: h };
          setEditorPhoto(blob); // objectURL 교체(이전 revoke)
        },
      });
    };

    // ---- Tag rows (공용 헬퍼) ----
    const edTagEls = wireTagRow(root.querySelector(".ed__tagrow") as HTMLElement, (t) => {
      edChosenTag = t;
      edHint.classList.remove("inp__hint--err");
    });
    const inpTagEls = wireTagRow(root.querySelector(".inp__tagrow") as HTMLElement, (t) => {
      inpChosenTag = t;
      inpHint.classList.remove("inp__hint--err");
    });

    // ---- Editor save: 단일 addCapture (ADR-018 — 이중 저장 수렴) ----
    edSave.onclick = async () => {
      if (phase !== "editing" || edSave.disabled) return;
      edSave.disabled = true; // 더블탭 가드 — 동기 차단, finally에서 해제
      try {
        await doEditorSave();
      } finally {
        edSave.disabled = false;
      }
    };

    async function doEditorSave() {
      const saveSw = new Stopwatch();
      const { passage, note, page } = readForm({ passage: edPassage, note: edNote, page: edPage });
      const ok = validate(
        { hasPhoto: !!pendingPhoto, passage, note, tag: edChosenTag },
        { passage: edPassage, note: edNote, hint: edHint },
      );
      if (!ok) return;

      const rec: Capture = {
        uuid: uuid(),
        sessionId: session.uuid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        image: pendingPhoto?.blob ?? null,
        passage,
        memo: note,
        tag: edChosenTag!,
        why: null,
        ocr: null,
        exportStatus: "none",
      };
      if (pendingPhoto) {
        rec.imageW = pendingPhoto.width;
        rec.imageH = pendingPhoto.height;
      }
      if (page) rec.page = page;

      const hadPhoto = !!pendingPhoto;
      const compressMs = pendingPhoto?.compressMs ?? 0;
      const sizeKB = pendingPhoto ? pendingPhoto.blob.size / 1024 : 0;

      await addCapture(rec);
      const captureMs = captureSw.stop();
      count += 1;
      cntEl.textContent = `📍 ${count} ›`;

      const appMs = shutterMs + saveSw.stop();
      const humanMs = Math.max(0, captureMs - appMs);
      record({ captureMs, appMs, humanMs, compressMs, sizeKB });
      renderHud({ appMs, humanMs, compressMs, sizeKB });

      if (hadPhoto) showDone();
      else flash("저장했어요");
      closeEditor(true);
    }

    // ---- Input mode: save ----
    inpSaveBtn.onclick = async () => {
      if (inpSaveBtn.disabled) return;
      inpSaveBtn.disabled = true; // 더블탭 가드 — 동기 차단, finally에서 해제
      try {
        await doInputSave();
      } finally {
        inpSaveBtn.disabled = false;
      }
    };

    async function doInputSave() {
      const { passage, note, page } = readForm({
        passage: inpPassage,
        note: inpNote,
        page: inpPage,
      });
      const ok = validate(
        { hasPhoto: false, passage, note, tag: inpChosenTag },
        { passage: inpPassage, note: inpNote, hint: inpHint },
      );
      if (!ok) return;
      // Sanity check via domain validator
      if (!isValidCapture({ image: null, passage, memo: note, tag: inpChosenTag! })) {
        return;
      }

      const rec: Capture = {
        uuid: uuid(),
        sessionId: session.uuid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        image: null,
        passage,
        memo: note,
        tag: inpChosenTag!,
        why: null,
        ocr: null,
        exportStatus: "none",
      };
      if (page) rec.page = page;

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
      inpNote.classList.remove("field--err");
      inpPassage.focus();

      flash("저장했어요");
    }

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

    // ---- 저장 토스트 (books/export 패턴) — 연속 저장 시 이전 타이머 리셋 ----
    const toast = root.querySelector(".toast") as HTMLElement;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    function flash(msg: string) {
      navigator.vibrate?.(30);
      toast.textContent = msg;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), 3000);
    }
  }

  // Cleanup: always stop camera (safe even if camera was never started)
  return () => {
    stopCamera();
    cropFrame?.destroy();
    cropFrame = null;
    if (pendingUrl) {
      URL.revokeObjectURL(pendingUrl);
      pendingUrl = null;
    }
  };
}

// ---- 공용 폼 헬퍼 — 편집 시트 + 입력 패널이 공유 ----

/** .tag 클릭 → is-sel 단일 토글 + onPick. 행의 tag 엘리먼트 목록을 반환(리셋용). */
function wireTagRow(rowEl: HTMLElement, onPick: (t: Tag) => void): HTMLElement[] {
  const els = Array.from(rowEl.querySelectorAll(".tag")) as HTMLElement[];
  els.forEach((el) => {
    el.onclick = () => {
      els.forEach((t) => t.classList.toggle("is-sel", t === el));
      onPick(el.dataset.tag as Tag);
    };
  });
  return els;
}

/** trim된 passage/note + 유효 page 번호를 읽는다. */
function readForm(els: {
  passage: HTMLTextAreaElement;
  note: HTMLTextAreaElement;
  page: HTMLInputElement;
}): { passage: string | null; note: string | null; page: number | undefined } {
  const passage = els.passage.value.trim() || null;
  const note = els.note.value.trim() || null;
  const pageNum = parseInt(els.page.value, 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : undefined;
  return { passage, note, page };
}

/** 검증: 사진 있으면 태그만 필수, 무사진이면 (passage ‖ note) + 태그 (ADR-014). */
function validate(
  v: { hasPhoto: boolean; passage: string | null; note: string | null; tag: Tag | null },
  els: { passage: HTMLTextAreaElement; note: HTMLTextAreaElement; hint: HTMLElement },
): boolean {
  if (!v.hasPhoto && !v.passage && !v.note) {
    els.passage.focus();
    els.passage.classList.add("field--err");
    els.note.classList.add("field--err");
    return false;
  }
  if (!v.tag) {
    els.hint.classList.add("inp__hint--err");
    els.hint.textContent = "태그를 골라야 저장할 수 있어요";
    return false;
  }
  return true;
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
      <div class="shutter-wrap"><button class="shutter" aria-label="촬영"></button></div>
    </div>

    <div class="input-panel">
      <div class="input-panel__inner">
        <div class="inp__hint">한 가지 태그를 고르세요</div>
        <div class="tagrow tagrow--light inp__tagrow">${tags}</div>
        <label class="inp__label">담고 싶은 글</label>
        <textarea class="field inp__passage" rows="6" placeholder="담고 싶은 글 (선택)"></textarea>
        <label class="inp__label">내 생각 (선택)</label>
        <textarea class="field inp__note" rows="2" placeholder="내 생각·메모 (선택)"></textarea>
        <div class="pagerow">
          <label class="inp__label pagerow__l">페이지</label>
          <input class="field inp__page" type="number" inputmode="numeric" min="1" placeholder="—" />
        </div>
        <button class="btn-primary inp__save">저장</button>
      </div>
    </div>

    <div class="edsheet">
      <div class="grab"></div>
      <div class="edsheet__scroll">
        <div class="ed__photo">
          <img class="ed__photoimg" alt="" hidden />
          <div class="ed__photoph">📷</div>
          <button class="btn-ghost ed__retake">다시 찍기</button>
        </div>
        <div class="inp__hint ed__hint">한 가지 태그를 고르세요</div>
        <div class="tagrow tagrow--light ed__tagrow">${tags}</div>
        <label class="inp__label">담은 글</label>
        <textarea class="field ed__passage" rows="4" placeholder="담고 싶은 글 (선택)"></textarea>
        <label class="inp__label">내 생각</label>
        <textarea class="field ed__note" rows="3" placeholder="내 생각 (선택)"></textarea>
        <div class="pagerow">
          <label class="inp__label pagerow__l">페이지</label>
          <input class="field ed__page" type="number" inputmode="numeric" min="1" placeholder="—" />
        </div>
        <button class="btn-primary ed__save">저장</button>
      </div>
    </div>

    <div class="done"><div class="done__badge">✓</div></div>
    <div class="toast" hidden></div>
  </div>`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
