/**
 * Capture 루프 — PRD §7-B / §16. 사진 경로.
 * 흐름: 셔터(동결) → 태그(필수, 단일) → Why(선택, 칩) → 저장 → 즉시 카메라 복귀.
 * 예산 계측: 웜업 / 앱 지연(appMs) / 사람 시간(humanMs) / 압축 / 용량을 HUD로 노출.
 */
import type { Nav } from "../app.ts";
import { startCamera, stopCamera } from "../camera/camera.ts";
import { grabFrame, resizeCompress } from "../lib/image.ts";
import { BUDGET, Stopwatch, record, within } from "../lib/budget.ts";
import { addCapture, countCaptures, getBook, getSession, uuid } from "../db/db.ts";
import { TAGS, WHY_CHIPS, type Capture, type Session, type Tag } from "../db/types.ts";

type Phase = "live" | "tagging" | "why";

export function mountCapture(root: HTMLElement, nav: Nav, sessionId: string): () => void {
  root.innerHTML = `<div class="cam"><div class="cam__boot">카메라 준비 중…</div></div>`;

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
    root.innerHTML = template(session, bookTitle, startCount);

    const cam = root.querySelector(".cam") as HTMLElement;
    const video = root.querySelector(".cam__video") as HTMLVideoElement;
    const freeze = root.querySelector(".cam__freeze") as HTMLImageElement;
    const hint = root.querySelector(".hint") as HTMLElement;
    const shutter = root.querySelector(".shutter") as HTMLButtonElement;
    const tagEls = Array.from(root.querySelectorAll(".tag")) as HTMLElement[];
    const cntEl = root.querySelector(".cnt") as HTMLElement;
    const scrim = root.querySelector(".sheet-scrim") as HTMLElement;
    const sheet = root.querySelector(".sheet") as HTMLElement;
    const sheetTag = root.querySelector(".sheet__tag") as HTMLElement;
    const chipEls = Array.from(root.querySelectorAll(".chip[data-why]")) as HTMLElement[];
    const writeChip = root.querySelector(".chip--write") as HTMLElement;
    const free = root.querySelector(".sheet__free") as HTMLTextAreaElement;
    const saveBtn = root.querySelector(".btn-save") as HTMLButtonElement;
    const done = root.querySelector(".done") as HTMLElement;
    const hud = root.querySelector(".hud") as HTMLElement;

    (root.querySelector(".cam__back") as HTMLElement).onclick = () => nav({ name: "home" });
    cntEl.onclick = () => nav({ name: "review", scope: "session", id: session.uuid });

    let phase: Phase = "live";
    let frame: ImageBitmap | null = null;
    let freezeUrl: string | null = null;
    let chosenTag: Tag | null = null;
    let chosenWhy: string | null = null;
    let count = startCount;
    let shutterMs = 0;
    const captureSw = new Stopwatch();

    const hudChip = (label: string, ms: number, budget?: number) => {
      const cls = budget == null ? "" : within(ms, budget) ? "ok" : "over";
      return `<span class="hud__chip ${cls}">${label} ${Math.round(ms)}${
        budget ? "/" + budget : ""
      }ms</span>`;
    };
    const sizeChip = (kb: number) =>
      `<span class="hud__chip ${kb <= 500 ? "ok" : "over"}">img ${Math.round(kb)}KB</span>`;

    // --- 카메라 웜업 (최대 리스크 측정) ---
    (async () => {
      try {
        const { warmupMs } = await startCamera(video);
        hud.innerHTML = hudChip("warmup", warmupMs, BUDGET.warmupMs);
        hint.textContent = "책 페이지를 담고 셔터를 누르세요";
      } catch (e) {
        hint.textContent = "카메라를 열 수 없어요. 권한을 확인해 주세요.";
        hud.innerHTML = `<span class="hud__chip over">camera: ${(e as Error).name}</span>`;
      }
    })();

    // --- 셔터: 프레임 동결 + 캡처 스톱워치 시작 ---
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

    // --- 태그 선택 → Why 시트 ---
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
      phase = "why";
      scrim.classList.add("is-open");
      sheet.classList.add("is-open");
    }
    function closeSheet() {
      scrim.classList.remove("is-open");
      sheet.classList.remove("is-open");
    }

    chipEls.forEach((el) => {
      el.onclick = () => {
        const v = el.dataset.why!;
        const already = el.classList.contains("is-sel");
        chipEls.forEach((c) => c.classList.remove("is-sel"));
        free.style.display = "none";
        chosenWhy = already ? null : ((el.classList.add("is-sel"), v) as string);
      };
    });
    writeChip.onclick = () => {
      chipEls.forEach((c) => c.classList.remove("is-sel"));
      free.style.display = "block";
      free.focus();
    };
    scrim.onclick = closeSheet;

    // --- 저장 ---
    saveBtn.onclick = async () => {
      if (!chosenTag) return;
      const saveSw = new Stopwatch();
      const freeVal = free.style.display === "block" ? free.value.trim() : "";
      const why = freeVal || chosenWhy || null;

      const rec: Capture = {
        uuid: uuid(),
        sessionId: session.uuid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        image: null,
        memo: null,
        tag: chosenTag,
        why,
        ocr: null,
        exportStatus: "none",
      };

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
      chosenWhy = null;
      cam.classList.remove("is-frozen");
      tagEls.forEach((t) => t.classList.remove("is-sel"));
      chipEls.forEach((c) => c.classList.remove("is-sel"));
      free.value = "";
      free.style.display = "none";
      hint.textContent = "책 페이지를 담고 셔터를 누르세요";
      if (freezeUrl) {
        URL.revokeObjectURL(freezeUrl);
        freezeUrl = null;
      }
    }
  }

  return () => stopCamera();
}

function template(session: Session, bookTitle: string, startCount: number) {
  const tags = TAGS.map(
    (t) =>
      `<button class="tag" data-tag="${t.key}" aria-label="${t.label}">${t.emoji}<span class="tag__l">${t.label}</span></button>`,
  ).join("");
  const chips = WHY_CHIPS.map((w) => `<button class="chip" data-why="${w}">${w}</button>`).join("");
  const project = session.project ? `<span class="sep">·</span> 🎯 ${esc(session.project)}` : "";
  return `
  <div class="cam">
    <video class="cam__video" playsinline muted></video>
    <img class="cam__freeze" alt="" />
    <div class="cam__scrim"></div>

    <div class="pill">
      <button class="cam__back" aria-label="홈">‹</button>
      📚 ${esc(bookTitle)} ${project}
      <button class="cnt" aria-label="리뷰">📍 ${startCount} ›</button>
    </div>

    <div class="hud"></div>

    <div class="bottom">
      <div class="hint">카메라 준비 중…</div>
      <div class="tagrow">${tags}</div>
      <div class="shutter-wrap"><button class="shutter" aria-label="촬영"></button></div>
    </div>

    <div class="sheet-scrim"></div>
    <div class="sheet">
      <div class="grab"></div>
      <div class="sheet__tag">⭐ 중요하다</div>
      <h2>왜 저장했나요?</h2>
      <div class="sheet__cap">한 번만 탭하면 끝 — 건너뛰어도 돼요.</div>
      <div class="chips">
        ${chips}
        <button class="chip chip--write">직접 입력…</button>
      </div>
      <textarea class="sheet__free" rows="2" placeholder="왜 저장했는지 한 줄" style="display:none"></textarea>
      <button class="btn-primary btn-save">저장</button>
    </div>

    <div class="done"><div class="done__badge">✓</div></div>
  </div>`;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
