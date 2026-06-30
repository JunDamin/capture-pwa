/** 앱 셸 + 인메모리 라우터. 화면 전환 시 이전 화면 cleanup(카메라 정지 등)을 호출. */
import { mountHome } from "./screens/home.ts";
import { mountBooks } from "./screens/books.ts";
import { mountCapture } from "./screens/capture.ts";
import { mountReview } from "./screens/review.ts";
import { mountExport } from "./screens/export.ts";
import { mountDetail } from "./screens/detail.ts";
import { mountTransfer } from "./screens/transfer.ts";

export type Scope = "session" | "book";

export type Route =
  | { name: "home" }
  | { name: "books" }
  | { name: "capture"; sessionId: string }
  | { name: "review"; scope: Scope; id: string }
  | { name: "export"; scope: Scope; id: string }
  | { name: "detail"; captureId: string; from: { scope: Scope; id: string } }
  | { name: "transfer" };

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
        cleanup = mountCapture(root, nav, route.sessionId);
        break;
      case "review":
        cleanup = mountReview(root, nav, route.scope, route.id);
        break;
      case "export":
        cleanup = mountExport(root, nav, route.scope, route.id);
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
