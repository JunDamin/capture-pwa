/**
 * PDF 생성 스모크 테스트 (chromium).
 *
 * buildPdf가 사진 있는/없는 캡처로 유효한 PDF Blob을 만드는지 실제 브라우저에서 확인한다.
 * vite dev 서버를 띄우고 chromium에서 src/lib/pdf.ts의 buildPdf를 호출한다.
 *
 * 한계: 이건 chromium(Blink) 스모크다. iOS Safari(WebKit) 고유 문제는 잡지 못한다
 *       (예: createImageBitmap 미지원). iOS는 실기기로 확인할 것.
 *
 * 실행: npm run test:pdf
 * 선행: npx playwright install chromium  (브라우저 캐시 필요)
 */
const { spawn } = require("child_process");
const http = require("http");

const URL = "http://localhost:5173/";

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
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    const g = c.getContext("2d");
    g.fillStyle = "#aabbcc";
    g.fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    const ctx = {
      bookTitle: "스모크 테스트 책",
      author: "저자",
      project: "프로젝트",
      scopeLabel: "이번 세션",
      captures: [
        { uuid: "1", sessionId: "s", createdAt: Date.now(), updatedAt: Date.now(), image: blob, imageW: 400, imageH: 300, memo: "메모", tag: "idea", why: "글감", ocr: null, exportStatus: "none", page: 42 },
        { uuid: "2", sessionId: "s", createdAt: Date.now(), updatedAt: Date.now(), image: null, memo: "사진 없는 캡처", tag: "important", why: null, ocr: null, exportStatus: "none" },
      ],
    };
    const out = await mod.buildPdf(ctx);
    return { ctor: out && out.constructor && out.constructor.name, size: out && out.size };
  });

  await browser.close();
  if (errors.length) throw new Error("page errors: " + errors.join("; "));
  if (result.ctor !== "Blob" || !(result.size > 1000)) {
    throw new Error("unexpected result: " + JSON.stringify(result));
  }
  return result;
}

(async () => {
  const dev = spawn("npm", ["run", "dev"], { stdio: "ignore" });
  let code = 0;
  try {
    await waitForServer(20000);
    const r = await run();
    console.log(`PASS — buildPdf produced ${r.ctor} (${r.size} bytes)`);
  } catch (e) {
    console.error("FAIL —", e.message);
    code = 1;
  } finally {
    dev.kill("SIGTERM");
  }
  process.exit(code);
})();
