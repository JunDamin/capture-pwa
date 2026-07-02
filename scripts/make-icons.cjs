/* icon.svg → PNG 래스터라이즈. 1회성 개발 도구 — 산출 PNG는 커밋. 선행: npx playwright install chromium */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SVG = fs.readFileSync(path.join(__dirname, "..", "public", "icon.svg"), "utf8");
// [name, canvasSize, iconScale] — maskable은 80%로 축소(safe zone)
const OUT = [
  ["apple-touch-icon-180.png", 180, 1],
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, 0.8],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, scale] of OUT) {
    const inner = Math.round(size * scale);
    const pad = Math.round((size - inner) / 2);
    // maskable 배경은 흰색(#FFFFFF), 아이콘 중앙 배치
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;background:#FFFFFF;display:grid;place-items:center">` +
        `<div style="width:${inner}px;height:${inner}px">${SVG.replace(/<svg /, '<svg style="width:100%;height:100%" ')}</div></body>`,
    );
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(__dirname, "..", "public", name), buf);
    console.log("wrote", name, buf.length, "bytes");
    void pad;
  }
  await browser.close();
})();
