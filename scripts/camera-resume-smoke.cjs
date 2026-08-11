/**
 * 카메라 복귀 스모크 테스트 (chromium, fake camera). ADR-021.
 *
 * 실제 iOS 백그라운드 전환은 재현할 수 없지만, 트랙을 강제로 stop한 뒤 visibilitychange를
 * 발생시키면 복귀 실패 상태(뷰파인더 정지 + 죽은 스트림)를 그대로 만들 수 있다.
 * 이 스크립트가 검증하는 것은 **복구 로직**이지 iOS 동작 자체가 아니다 — iOS는 실기기 확인(ADR-013).
 *
 * 확인:
 *   1. 트랙 사망 + visibilitychange → 뷰파인더가 되살아난다(새 스트림, 프레임 전진)
 *   2. 죽은 상태에서 셔터 → 낡은 프레임이 저장되지 않는다
 *   3. 멀쩡한 상태에서 visibilitychange → 재시작하지 않는다(불필요한 웜업 회귀 방지)
 *   4. 화면을 떠나면 복귀 리스너가 남지 않는다
 *
 * 실행: npm run test:camera
 * 선행: npx playwright install chromium
 */
const { spawn } = require("child_process");
const http = require("http");

const URL = "http://localhost:5223/"; // 전용 포트(잔류 dev 서버·다른 스모크와 충돌 방지)

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

/** 페이지에서 카메라 트랙을 감시하려면 getUserMedia가 준 스트림을 붙잡아야 한다. */
const TRACK_SPY = `
  window.__streams = [];
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await orig(c);
    window.__streams.push(s);
    return s;
  };
  // 복귀 리스너 누수 확인용 카운터
  window.__visListeners = 0;
  const addDoc = document.addEventListener.bind(document);
  const removeDoc = document.removeEventListener.bind(document);
  document.addEventListener = (t, f, o) => { if (t === "visibilitychange") window.__visListeners++; return addDoc(t, f, o); };
  document.removeEventListener = (t, f, o) => { if (t === "visibilitychange") window.__visListeners--; return removeDoc(t, f, o); };
`;

async function run() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(TRACK_SPY);
  await page.context().grantPermissions(["camera"]);
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(400);

  // 책 + 열린 세션 시드 후 사진 모드 캡처 화면 마운트
  const sid = await page.evaluate(async () => {
    const db = await import("/src/db/db.ts");
    const { mountApp } = await import("/src/app.ts");
    await db.putBook({ uuid: "b1", title: "카메라 테스트 책" });
    const sid = await db.currentRoundFor("b1");
    const root = document.getElementById("app");
    root.innerHTML = "";
    window.__nav = mountApp(root);
    window.__nav({ name: "capture", sessionId: sid, mode: "photo" });
    return sid;
  });

  await page.waitForSelector(".shutter", { timeout: 10000 });
  await page.waitForFunction(() => {
    const v = document.querySelector(".cam__video");
    return v && v.videoWidth > 0 && !v.paused;
  }, null, { timeout: 15000 });

  const results = {};
  const streamCount = () => page.evaluate(() => window.__streams.length);
  const liveTracks = () =>
    page.evaluate(() =>
      window.__streams.map((s) => s.getVideoTracks().map((t) => t.readyState).join(",")),
    );
  const videoState = () =>
    page.evaluate(() => {
      const v = document.querySelector(".cam__video");
      return { paused: v.paused, w: v.videoWidth, t: v.currentTime };
    });
  const captureCount = (sid) =>
    page.evaluate(async (sid) => {
      const db = await import("/src/db/db.ts");
      return (await db.capturesForSession(sid)).length;
    }, sid);

  // --- 3) 먼저 멀쩡한 상태에서 visibilitychange → 재시작이 없어야 한다 ---
  const before = await streamCount();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1200);
  results.healthyResume = { streamsBefore: before, streamsAfter: await streamCount() };

  // --- 트랙을 죽여 "다른 앱 다녀온" 상태를 만든다 ---
  await page.evaluate(() => {
    window.__streams[window.__streams.length - 1].getTracks().forEach((t) => t.stop());
  });
  await page.waitForTimeout(300);
  const dead1 = await videoState();
  await page.waitForTimeout(400);
  const dead2 = await videoState();
  results.whileDead = { video: { ...dead2, frozen: dead2.t === dead1.t }, tracks: await liveTracks() };

  // --- 2) 죽은 상태에서 셔터 → 저장되지 않아야 한다 ---
  const capsBefore = await captureCount(sid);
  await page.click(".shutter");
  await page.waitForTimeout(600);
  results.shutterWhileDead = {
    capsBefore,
    capsAfter: await captureCount(sid),
    sheetOpen: await page.evaluate(() =>
      document.querySelector(".edsheet").classList.contains("is-open"),
    ),
    hint: await page.evaluate(() => document.querySelector(".hint").textContent),
  };

  // --- 1) 복귀 → 되살아나야 한다 (셔터가 이미 복구를 걸었을 수 있으니 기다린 뒤 한 번 더) ---
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(() => {
    const v = document.querySelector(".cam__video");
    return v && !v.paused && v.videoWidth > 0;
  }, null, { timeout: 15000 });
  const t1 = (await videoState()).t;
  await page.waitForTimeout(400);
  const t2 = (await videoState()).t;
  results.recovered = {
    streams: await streamCount(),
    tracks: await liveTracks(),
    advanced: t2 > t1,
    hint: await page.evaluate(() => document.querySelector(".hint").textContent),
  };

  // 복구 후 셔터가 정상 동작하는지
  await page.click(".shutter");
  await page.waitForTimeout(600);
  results.shutterAfterRecovery = {
    slots: await page.evaluate(() => document.querySelectorAll(".ed__slotimg").length),
  };

  // --- 4) 화면 이탈 → 복귀 리스너가 남지 않아야 한다 ---
  results.listenersMounted = await page.evaluate(() => window.__visListeners);
  await page.evaluate(() => window.__nav({ name: "home" }));
  await page.waitForTimeout(400);
  results.listenersAfterLeave = await page.evaluate(() => window.__visListeners);

  await browser.close();
  return { results, errors };
}

function check(results, errors) {
  const fail = [];
  if (errors.length) fail.push("page errors: " + errors.join("; "));

  const h = results.healthyResume;
  if (h.streamsAfter !== h.streamsBefore) {
    fail.push(`멀쩡한 상태에서 재시작이 일어남 (스트림 ${h.streamsBefore} → ${h.streamsAfter})`);
  }
  // 테스트가 헛돌지 않게 — 복구를 확인하기 전에 "정말 죽어 있었는지"를 먼저 단언한다
  if (!results.whileDead.tracks.some((t) => t.includes("ended"))) {
    fail.push("트랙을 죽이지 못함 — 이후 복구 단언이 무의미하다");
  }
  if (results.whileDead.video.frozen === false) {
    fail.push("트랙 사망 후에도 프레임이 계속 전진함 — 재현 실패");
  }
  if (results.shutterWhileDead.capsAfter !== results.shutterWhileDead.capsBefore) {
    fail.push("죽은 스트림 상태에서 셔터가 낡은 프레임을 저장함");
  }
  if (results.shutterWhileDead.sheetOpen) {
    fail.push("죽은 스트림 상태에서 편집 시트가 올라옴");
  }
  if (results.recovered.streams <= h.streamsAfter) {
    fail.push("복구 시 새 스트림을 열지 않음");
  }
  if (!results.recovered.advanced) {
    fail.push("복구 후에도 프레임이 전진하지 않음(정지 화면)");
  }
  if (!results.recovered.tracks.some((t) => t.includes("live"))) {
    fail.push("복구 후 live 트랙이 없음");
  }
  if (results.shutterAfterRecovery.slots !== 1) {
    fail.push(`복구 후 셔터가 동작하지 않음 (슬롯 ${results.shutterAfterRecovery.slots})`);
  }
  if (results.listenersAfterLeave !== 0) {
    fail.push(`화면 이탈 후 visibilitychange 리스너 잔류 (${results.listenersAfterLeave})`);
  }
  return fail;
}

(async () => {
  const dev = spawn("npm", ["run", "dev", "--", "--port", "5223", "--strictPort"], {
    stdio: "ignore",
  });
  let code = 0;
  try {
    await waitForServer(20000);
    const { results, errors } = await run();
    const fail = check(results, errors);
    if (fail.length) {
      console.error("FAIL —\n  " + fail.join("\n  "));
      console.error(JSON.stringify(results, null, 2));
      code = 1;
    } else {
      console.log(
        `PASS — 죽은 스트림 복구 확인 (스트림 ${results.healthyResume.streamsBefore} → ${results.recovered.streams}, 멀쩡할 땐 재시작 없음, 낡은 프레임 저장 차단, 리스너 누수 없음)`,
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
