import "./styles/tokens.css";
import "./styles/app.css";
import { getBook, getSession, putBook, putSession, uuid } from "./db/db.ts";
import { mountCapture } from "./screens/capture.ts";
import type { Book, Session } from "./db/types.ts";

const app = document.getElementById("app")!;

/**
 * 마일스톤 1: 데모 세션을 자동 생성해 캡처 루프를 바로 띄운다.
 * (Home / 책 등록 / 세션 선택 화면은 다음 마일스톤)
 */
const DEMO_BOOK = "demo-book";
const DEMO_SESSION = "demo-session";

async function boot() {
  let book = await getBook(DEMO_BOOK);
  if (!book) {
    book = { uuid: DEMO_BOOK, title: "원자 습관", author: "제임스 클리어" } as Book;
    await putBook(book);
  }
  let session = await getSession(DEMO_SESSION);
  if (!session) {
    session = {
      uuid: DEMO_SESSION,
      bookId: book.uuid,
      project: "지방교육",
      started: Date.now(),
      ended: null,
    } as Session;
    await putSession(session);
  }
  void uuid; // (다음 마일스톤에서 새 세션 생성에 사용)

  mountCapture(app, session, book.title);
}

boot();
