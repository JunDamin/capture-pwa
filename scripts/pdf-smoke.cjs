/**
 * PDF 생성 스모크 테스트 (chromium).
 *
 * buildPdf가 사진 있는/없는/2장인 캡처로 유효한 PDF Blob을 만드는지 실제 브라우저에서 확인한다.
 * vite dev 서버를 띄우고 chromium에서 src/lib/pdf.ts의 buildPdf를 호출한다.
 * 페이지 수(표지 1 + 사진 총 장수)와 prompt.md의 capture-NNa/b 파일명 lockstep도 함께 확인한다(ADR-020).
 *
 * 한계: 이건 chromium(Blink) 스모크다. iOS Safari(WebKit) 고유 문제는 잡지 못한다
 *       (예: createImageBitmap 미지원). iOS는 실기기로 확인할 것.
 *
 * 실행: npm run test:pdf
 * 선행: npx playwright install chromium  (브라우저 캐시 필요)
 */
const { spawn } = require("child_process");
const http = require("http");

const URL = "http://localhost:5219/"; // 전용 포트(잔류 dev 서버와 충돌 방지)

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(URL, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("dev server did not start"));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

async function run() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const mod = await import("/src/lib/pdf.ts");
    const promptMod = await import("/src/lib/prompt.ts");
    const shot = async (fill) => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 300;
      const g = c.getContext("2d");
      g.fillStyle = fill;
      g.fillRect(0, 0, 400, 300);
      return new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    };
    const blob = await shot("#aabbcc");
    const blobA = await shot("#ccbbaa");
    const blobB = await shot("#bbccaa");
    const ctx = {
      bookTitle: "스모크 테스트 책",
      author: "저자",
      project: "프로젝트",
      scopeLabel: "이번 세션",
      captures: [
        { uuid: "1", sessionId: "s", createdAt: Date.now(), updatedAt: Date.now(), image: blob, imageW: 400, imageH: 300, memo: "메모", tag: "idea", why: "글감", ocr: null, exportStatus: "none", page: 42 },
        { uuid: "2", sessionId: "s", createdAt: Date.now(), updatedAt: Date.now(), image: null, memo: "사진 없는 캡처", tag: "important", why: null, ocr: null, exportStatus: "none" },
        // 사진 2장 — 같은 글이 다음 페이지로 이어지는 캡처 (ADR-020)
        { uuid: "3", sessionId: "s", createdAt: Date.now(), updatedAt: Date.now(), image: blobA, imageW: 400, imageH: 300, image2: blobB, image2W: 400, image2H: 300, memo: "이어지는 글", tag: "interesting", why: null, ocr: null, exportStatus: "none", page: 88 },
      ],
    };
    const out = await mod.buildPdf(ctx);
    const text = await out.text();
    // jsPDF 출력에서 /Type /Page(단수)만 센다 — /Type /Pages(카탈로그)는 제외
    const pages = text.split("/Type /Page").length - text.split("/Type /Pages").length;
    const pkg = promptMod.buildExport(ctx);
    return {
      ctor: out && out.constructor && out.constructor.name,
      size: out && out.size,
      pages,
      imageCount: pkg.imageCount,
      promptMd: pkg.promptMd,
    };
  });

  await browser.close();
  if (errors.length) throw new Error("page errors: " + errors.join("; "));
  if (result.ctor !== "Blob" || !(result.size > 1000)) {
    throw new Error("unexpected result: " + JSON.stringify(result));
  }
  // 표지 1 + 사진 3장(캡처1: 1장, 캡처2: 0장, 캡처3: 2장) = 4페이지
  if (result.pages !== 4) {
    throw new Error(`expected 4 pages (cover + 3 photos), got ${result.pages}`);
  }
  if (result.imageCount !== 3) {
    throw new Error(`expected imageCount 3, got ${result.imageCount}`);
  }
  // prompt.md ↔ PDF 페이지 헤더 lockstep: 1장은 접미사 없음, 2장은 a/b
  for (const name of ["capture-01.jpg", "capture-03a.jpg", "capture-03b.jpg"]) {
    if (!result.promptMd.includes(name)) throw new Error(`prompt.md missing ${name}`);
  }
  if (!result.promptMd.includes("같은 글이 이어짐")) {
    throw new Error("prompt.md missing 2-photo continuation note");
  }
  return result;
}

(async () => {
  const dev = spawn("npm", ["run", "dev", "--", "--port", "5219", "--strictPort"], { stdio: "ignore" });
  let code = 0;
  try {
    await waitForServer(20000);
    const r = await run();
    console.log(`PASS — buildPdf produced ${r.ctor} (${r.size} bytes, ${r.pages} pages, ${r.imageCount} photos)`);
  } catch (e) {
    console.error("FAIL —", e.message);
    code = 1;
  } finally {
    dev.kill("SIGTERM");
  }
  process.exit(code);
})();
