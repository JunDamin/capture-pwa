/** 백업·설정 — 전체 데이터를 단일 JSON으로 내보내고/복원 + 앱 설정. */
import type { Nav } from "../app.ts";
import { buildBackup, importBackup } from "../lib/backup.ts";
import { downloadFile } from "../lib/share.ts";
import { getTtbKey, setTtbKey } from "../lib/aladin.ts";

export function mountTransfer(root: HTMLElement, nav: Nav): () => void {
  root.innerHTML = `
  <div class="scr scr--light transfer">
    <div class="topbar">
      <button class="iconbtn back">‹</button>
      <div class="topbar__t">백업·설정</div>
    </div>

    <div class="card">
      <div class="card__h">백업</div>
      <div class="exp__how">모든 책·기록·캡처(사진 포함)를 파일 하나로 내려받아요. 다른 기기에서 가져오기로 복원할 수 있어요.</div>
      <button class="btn-primary backup">💾 백업 파일 내려받기</button>
    </div>

    <div class="card">
      <div class="card__h">가져오기</div>
      <div class="exp__how">백업 파일(.json)을 선택하면 이 기기에 복원해요. 같은 항목은 덮어써요(중복 안 생김).</div>
      <input class="t-file" type="file" accept="application/json,.json" hidden />
      <button class="btn-ghost pick">📥 백업 파일 선택</button>
    </div>

    <div class="card">
      <div class="card__h">알라딘 TTB 키</div>
      <div class="setting__s">표지 검색에 사용해요. aladin.co.kr에서 무료 발급.</div>
      <input class="field ttbkey" placeholder="TTB 키" autocomplete="off" value="${esc(getTtbKey() ?? "")}" />
      <button class="btn-ghost savekey">저장</button>
    </div>

    <div class="toast" hidden></div>
  </div>`;

  const toast = root.querySelector(".toast") as HTMLElement;
  const flash = (msg: string) => {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), 2400);
  };

  (root.querySelector(".back") as HTMLElement).onclick = () => nav({ name: "home" });

  (root.querySelector(".backup") as HTMLButtonElement).onclick = async () => {
    try {
      const blob = await buildBackup(Date.now());
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const name = `capture-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
      downloadFile({ name, blob });
      flash("백업 파일을 내려받았어요");
    } catch (e) {
      console.error("backup failed", e);
      flash("백업에 실패했어요");
    }
  };

  const file = root.querySelector(".t-file") as HTMLInputElement;
  (root.querySelector(".pick") as HTMLButtonElement).onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const r = await importBackup(text);
      flash(`책 ${r.books} · 기록 ${r.sessions} · 캡처 ${r.captures} 복원했어요`);
    } catch (e) {
      console.error("import failed", e);
      flash("백업 파일을 읽지 못했어요(형식 확인)");
    } finally {
      file.value = "";
    }
  };

  const keyInput = root.querySelector(".ttbkey") as HTMLInputElement;
  (root.querySelector(".savekey") as HTMLButtonElement).onclick = () => {
    setTtbKey(keyInput.value);
    flash(keyInput.value.trim() ? "키를 저장했어요" : "키를 제거했어요");
  };

  return () => {};
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
