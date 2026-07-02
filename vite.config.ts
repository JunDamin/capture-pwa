import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages는 /<repo>/ 하위로 서빙된다.
// 배포 워크플로가 VITE_BASE=/<repo>/ 를 주입한다. 로컬은 "/".
const base = process.env.VITE_BASE || "/";

// 빌드 시각 스탬프 — epoch ms(숫자)로 심고 표시 시 기기 로컬 시간대로 포맷(home.ts).
const buildTs = Date.now();

export default defineConfig({
  base,
  define: {
    __BUILD__: JSON.stringify(buildTs),
  },
  server: { host: true, port: 5173 },
  build: { target: "es2020" },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg", "apple-touch-icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],
      manifest: {
        name: "Capture",
        short_name: "Capture",
        description: "생각을 AI에게 가장 잘 전달하는 입력 인터페이스",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "any",
        background_color: "#FFFFFF",
        theme_color: "#3182F6",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
        share_target: {
          action: "./",
          method: "GET",
          params: { title: "shared_title", text: "shared_text", url: "shared_url" },
        },
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2,png}"],
        navigateFallback: null,
        ignoreURLParametersMatching: [/^utm_/, /^shared_/],
      },
    }),
  ],
});
