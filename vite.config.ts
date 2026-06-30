import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages는 /<repo>/ 하위로 서빙된다.
// 배포 워크플로가 VITE_BASE=/<repo>/ 를 주입한다. 로컬은 "/".
const base = process.env.VITE_BASE || "/";

// 빌드 시각 스탬프(빌드 타임 Node — 앱 런타임 아님). 화면에 표시해 어떤 버전이 도는지 확인.
const buildId = new Date().toISOString().slice(5, 16).replace("T", " "); // "MM-DD HH:mm"

export default defineConfig({
  base,
  define: {
    __BUILD__: JSON.stringify(buildId),
  },
  server: { host: true, port: 5173 },
  build: { target: "es2020" },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg"],
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
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: null,
      },
    }),
  ],
});
