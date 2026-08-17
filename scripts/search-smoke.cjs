/**
 * 전역 검색 스모크 테스트 (chromium). ADR-022.
 *
 * 이 앱의 검색은 "텍스트를 찾겠다고 사진을 메모리에 올리지 않는다"가 핵심 계약이다
 * (passage/memo가 이미지와 같은 레코드에 있다 — ADR-013/015). 그래서 이 스크립트의
 * 가장 중요한 단언은 **검색 결과 객체에 이미지 필드가 없다**는 것이다.
 *
 * 한계: chromium(Blink) 스모크다. iOS 실기기의 메모리 한계는 잡지 못한다(ADR-013).
 *
 * 실행: npm run test:search
 * 선행: npx playwright install chromium
 */
const { spawn } = require("child_process");
const http = require("http");

const URL = "http://localhost:5227/"; // 전용 포트(다른 스모크와 충돌 방지)

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

/** 픽스처: 책 2권 + 사진 있는/없는 캡처. 텍스트는 서로 겹치지 않게. */
async function seed(page) {
  return page.evaluate(async () => {
    const db = await import("/src/db/db.ts");
    const shot = async () => {
      const c = document.createElement("canvas");
      c.width = 40;
      c.height = 30;
      const g = c.getContext("2d");
      g.fillStyle = "#abc";
      g.fillRect(0, 0, 40, 30);
      return new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    };
    await db.putBook({ uuid: "bk1", title: "사피엔스", author: "하라리" });
    await db.putBook({ uuid: "bk2", title: "코스모스", author: "세이건" });
    const s1 = await db.currentRoundFor("bk1");
    const s2 = await db.currentRoundFor("bk2");
    const base = { image2: null, why: null, ocr: null, exportStatus: "none" };
    const t0 = 1_700_000_000_000;
    // 사진 있는 캡처 — 검색이 이미지를 건드리지 않는지 확인하는 핵심 픽스처
    await db.addCapture({ ...base, uuid: "cap-photo", sessionId: s1, createdAt: t0,
      updatedAt: t0, image: await shot(), imageW: 40, imageH: 30,
      passage: "인지혁명은 허구를 믿는 능력에서 시작됐다", memo: null, tag: "important" });
    // 사진 없는 캡처
    await db.addCapture({ ...base, uuid: "cap-text", sessionId: s1, createdAt: t0 + 1000,
      updatedAt: t0 + 1000, image: null, passage: null,
      memo: "허구가 협력을 만든다는 게 흥미롭다", tag: "interesting" });
    // 다른 책 — 책별 묶음 확인용
    await db.addCapture({ ...base, uuid: "cap-other", sessionId: s2, createdAt: t0 + 2000,
      updatedAt: t0 + 2000, image: null, passage: "코스모스는 과거에도 현재에도 미래에도 있다",
      memo: null, tag: "idea" });
    // 매치되지 않는 캡처
    await db.addCapture({ ...base, uuid: "cap-none", sessionId: s2, createdAt: t0 + 3000,
      updatedAt: t0 + 3000, image: null, passage: "관계없는 내용", memo: null, tag: "idea" });
    return { s1, s2 };
  });
}

async function run() {
  const { chromium, devices } = require("playwright");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(400);
  await seed(page);

  const out = await page.evaluate(async () => {
    const db = await import("/src/db/db.ts");
    const r = {};
    // 1) 텍스트로 찾는다 — 사진 있는 캡처도 포함
    const hit = await db.searchCaptures("허구");
    r.basic = {
      count: hit.hits.length,
      uuids: hit.hits.map((h) => h.uuid),
      truncated: hit.truncated,
      fields: hit.hits.map((h) => h.field),
      snippets: hit.hits.map((h) => h.snippet),
    };
    // 2) 핵심 계약 — 결과 객체에 이미지 필드가 없다
    r.keys = hit.hits.map((h) => Object.keys(h).sort());
    // 3) 최신 우선
    r.order = hit.hits.map((h) => h.createdAt);
    // 4) 상한
    const lim = await db.searchCaptures("허구", 1);
    r.limited = { count: lim.hits.length, truncated: lim.truncated };
    // 5) 빈 질의
    const empty = await db.searchCaptures("   ");
    r.empty = { count: empty.hits.length, truncated: empty.truncated };
    // 6) 대소문자 무시
    const other = await db.searchCaptures("코스모스");
    r.other = other.hits.map((h) => h.uuid);
    return r;
  });

  // ---- 화면 단언 ----
  // objectURL 누수 감시 — 생성/해제 수를 센다
  await page.evaluate(() => {
    window.__urls = { made: 0, freed: 0 };
    const co = URL.createObjectURL.bind(URL);
    const ro = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__urls.made++; return co(b); };
    URL.revokeObjectURL = (u) => { window.__urls.freed++; return ro(u); };
  });

  await page.evaluate(async () => {
    const { mountApp } = await import("/src/app.ts");
    const root = document.getElementById("app");
    root.innerHTML = "";
    window.__nav = mountApp(root);
    window.__nav({ name: "search", q: "허구" });
  });
  await page.waitForSelector(".search", { timeout: 8000 });
  await page.waitForTimeout(500);

  out.screen = await page.evaluate(() => ({
    query: document.querySelector(".search__input").value,
    groups: Array.from(document.querySelectorAll(".sgroup")).map((g) => ({
      book: g.querySelector(".sgroup__t").textContent.trim(),
      hits: g.querySelectorAll(".shit").length,
    })),
    marks: Array.from(document.querySelectorAll(".shit mark")).map((m) => m.textContent),
  }));

  // 책 제목만 매치 — 캡처 매치가 없어도 헤더가 나와야 한다
  await page.evaluate(() => window.__nav({ name: "search", q: "코스모스" }));
  await page.waitForTimeout(600);
  out.titleOnly = await page.evaluate(() => ({
    groups: Array.from(document.querySelectorAll(".sgroup")).map((g) => g.querySelector(".sgroup__t").textContent.trim()),
    badges: Array.from(document.querySelectorAll(".sgroup__n")).map((b) => b.textContent.trim()),
  }));

  // 결과 없음
  await page.evaluate(() => window.__nav({ name: "search", q: "존재하지않는말" }));
  await page.waitForTimeout(600);
  out.emptyState = await page.evaluate(() => document.querySelector(".search__empty")?.textContent ?? null);

  // 검색 → 캡처 상세 → 뒤로 = 검색 복귀 + 검색어 유지
  await page.evaluate(() => window.__nav({ name: "search", q: "허구" }));
  await page.waitForSelector(".shit", { timeout: 8000 });
  await page.click(".shit");
  await page.waitForSelector(".detail", { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.click(".detail .back");
  await page.waitForSelector(".search", { timeout: 8000 });
  await page.waitForTimeout(400);
  out.backToSearch = await page.evaluate(() => ({
    onSearch: !!document.querySelector(".search"),
    query: document.querySelector(".search__input")?.value ?? null,
    hits: document.querySelectorAll(".shit").length,
  }));

  // objectURL 누수 — 화면을 떠나면 만든 만큼 해제돼야 한다
  await page.evaluate(() => window.__nav({ name: "home" }));
  await page.waitForTimeout(500);
  out.urls = await page.evaluate(() => ({ ...window.__urls }));

  // ---- 홈 진입 ----
  await page.waitForSelector(".home__search", { timeout: 8000 });
  // 1글자는 진입하지 않는다
  await page.fill(".home__search", "허");
  await page.waitForTimeout(500);
  out.oneChar = await page.evaluate(() => !!document.querySelector(".search"));
  // 2글자면 진입한다
  await page.fill(".home__search", "허구");
  await page.waitForSelector(".search", { timeout: 8000 });
  out.twoChar = await page.evaluate(() => ({
    onSearch: !!document.querySelector(".search"),
    query: document.querySelector(".search__input").value,
  }));

  await browser.close();
  return { out, errors };
}

function check(out, errors) {
  const fail = [];
  if (errors.length) fail.push("page errors: " + errors.join("; "));

  // 1) "허구"는 사진 있는 캡처(passage)와 사진 없는 캡처(memo) 둘 다에 있다
  const uuids = out.basic.uuids.slice().sort();
  if (uuids.join(",") !== "cap-photo,cap-text") {
    fail.push(`"허구" 검색 결과가 예상과 다름: ${JSON.stringify(out.basic.uuids)}`);
  }
  if (out.basic.truncated) fail.push("상한에 안 걸렸는데 truncated가 true");
  if (!out.basic.fields.includes("passage") || !out.basic.fields.includes("memo")) {
    fail.push(`field가 passage/memo를 모두 보고하지 않음: ${JSON.stringify(out.basic.fields)}`);
  }
  if (!out.basic.snippets.every((s) => s.includes("허구"))) {
    fail.push(`스니펫에 검색어가 없음: ${JSON.stringify(out.basic.snippets)}`);
  }

  // 2) 핵심 계약 — 이미지 필드 비적재
  for (const keys of out.keys) {
    for (const bad of ["image", "image2", "imageW", "imageH", "image2W", "image2H"]) {
      if (keys.includes(bad)) fail.push(`검색 결과에 이미지 필드 '${bad}'가 실려 있다 — 계약 위반`);
    }
  }

  // 3) 최신 우선
  const sorted = out.order.slice().sort((a, b) => b - a);
  if (JSON.stringify(out.order) !== JSON.stringify(sorted)) {
    fail.push(`최신순이 아님: ${JSON.stringify(out.order)}`);
  }

  // 4) 상한
  if (out.limited.count !== 1 || out.limited.truncated !== true) {
    fail.push(`limit 1에서 상한 표시가 틀림: ${JSON.stringify(out.limited)}`);
  }

  // 5) 빈 질의
  if (out.empty.count !== 0 || out.empty.truncated !== false) {
    fail.push(`빈 질의 결과가 틀림: ${JSON.stringify(out.empty)}`);
  }

  // 6) 다른 책
  if (JSON.stringify(out.other) !== JSON.stringify(["cap-other"])) {
    fail.push(`"코스모스" 검색 결과가 틀림: ${JSON.stringify(out.other)}`);
  }

  // --- 화면 ---
  if (out.screen.query !== "허구") fail.push(`검색 입력에 질의가 안 남음: ${out.screen.query}`);
  if (out.screen.groups.length !== 1) {
    fail.push(`"허구"는 사피엔스 한 권에만 있어야 함: ${JSON.stringify(out.screen.groups)}`);
  } else {
    if (!out.screen.groups[0].book.includes("사피엔스")) {
      fail.push(`책 헤더가 틀림: ${out.screen.groups[0].book}`);
    }
    if (out.screen.groups[0].hits !== 2) {
      fail.push(`히트 수가 틀림: ${out.screen.groups[0].hits}`);
    }
  }
  if (!out.screen.marks.length || !out.screen.marks.every((m) => m === "허구")) {
    fail.push(`매치 강조가 없거나 틀림: ${JSON.stringify(out.screen.marks)}`);
  }

  // 책 제목만 매치돼도 헤더 노출 — "코스모스"는 책 제목이자 캡처 본문에도 있다
  if (!out.titleOnly.groups.some((g) => g.includes("코스모스"))) {
    fail.push(`제목 매치 책이 안 나옴: ${JSON.stringify(out.titleOnly.groups)}`);
  }

  if (!out.emptyState || !out.emptyState.includes("없어요")) {
    fail.push(`결과 없음 문구가 없음: ${out.emptyState}`);
  }

  // 뒤로가기 복귀
  if (!out.backToSearch.onSearch) fail.push("상세에서 뒤로 갔는데 검색 화면이 아님");
  if (out.backToSearch.query !== "허구") {
    fail.push(`뒤로가기 후 검색어를 잃음: ${out.backToSearch.query}`);
  }
  if (out.backToSearch.hits !== 2) {
    fail.push(`뒤로가기 후 결과가 복원되지 않음: ${out.backToSearch.hits}`);
  }

  // objectURL 누수
  if (out.urls.made !== out.urls.freed) {
    fail.push(`objectURL 누수: 생성 ${out.urls.made} / 해제 ${out.urls.freed}`);
  }

  // 홈 진입
  if (out.oneChar) fail.push("한 글자만 입력했는데 검색 화면으로 넘어감");
  if (!out.twoChar.onSearch) fail.push("두 글자를 입력했는데 검색 화면으로 안 넘어감");
  if (out.twoChar.query !== "허구") {
    fail.push(`홈에서 넘긴 검색어가 틀림: ${out.twoChar.query}`);
  }
  return fail;
}

(async () => {
  const dev = spawn("npm", ["run", "dev", "--", "--port", "5227", "--strictPort"], {
    stdio: "ignore",
  });
  let code = 0;
  try {
    await waitForServer(20000);
    const { out, errors } = await run();
    const fail = check(out, errors);
    if (fail.length) {
      console.error("FAIL —\n  " + fail.join("\n  "));
      console.error(JSON.stringify(out, null, 2));
      code = 1;
    } else {
      console.log(
        `PASS — 검색 계약 확인 (히트 ${out.basic.count}건, 이미지 필드 비적재, 최신순, 상한 표시)`,
      );
    }
  } catch (e) {
    console.error("FAIL —", e.message);
    code = 1;
  } finally {
    dev.kill("SIGTERM");
  }
  process.exit(code);
})();
