/** 앱 셸 + 인메모리 라우터. 화면 전환 시 이전 화면 cleanup(카메라 정지 등)을 호출. */
import { mountHome } from "./screens/home.ts";
import { mountBooks } from "./screens/books.ts";
import { mountCapture } from "./screens/capture.ts";
import { mountReview } from "./screens/review.ts";
import { mountExport } from "./screens/export.ts";
import { mountDetail } from "./screens/detail.ts";
import { mountSearch } from "./screens/search.ts";
import { mountTransfer } from "./screens/transfer.ts";

export type Scope = "session" | "book";

export type Route =
  | { name: "home" }
  | { name: "books" }
  | { name: "capture"; sessionId: string; mode?: "photo" | "input" }
  | { name: "review"; scope: Scope; id: string }
  | { name: "export"; scope: Scope; id: string }
  | { name: "search"; q: string }
  // 검색에서 연 캡처는 뒤로가기가 검색 결과로 돌아가야 한다(검색어 유지) — ADR-022.
  // Scope 자체는 넓히지 않는다: review.ts가 scope로 조회 방식을 가르므로 "search"를 섞으면 깨진다.
  | {
      name: "detail";
      captureId: string;
      from: { scope: Scope; id: string } | { scope: "search"; q: string };
    }
  | { name: "transfer" };

export type DetailFrom = Extract<Route, { name: "detail" }>["from"];

export type Nav = (route: Route) => void;

export type Screen = (root: HTMLElement, nav: Nav) => void | (() => void);

export function mountApp(root: HTMLElement) {
  let cleanup: (() => void) | void;

  const nav: Nav = (route) => {
    if (typeof cleanup === "function") cleanup();
    cleanup = undefined;
    root.scrollTop = 0;

    switch (route.name) {
      case "home":
        cleanup = mountHome(root, nav);
        break;
      case "books":
        cleanup = mountBooks(root, nav);
        break;
      case "capture":
        cleanup = mountCapture(root, nav, route.sessionId, route.mode);
        break;
      case "review":
        cleanup = mountReview(root, nav, route.scope, route.id);
        break;
      case "export":
        cleanup = mountExport(root, nav, route.scope, route.id);
        break;
      case "search":
        cleanup = mountSearch(root, nav, route.q);
        break;
      case "detail":
        cleanup = mountDetail(root, nav, route.captureId, route.from);
        break;
      case "transfer":
        cleanup = mountTransfer(root, nav);
        break;
    }
  };

  return nav;
}
