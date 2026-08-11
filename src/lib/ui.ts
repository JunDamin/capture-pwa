/**
 * 공용 UI 유틸 — 여러 화면에 복붙돼 있던 escape/toast/시각 포맷을 단일화한다.
 * 딥모듈(좁은 인터페이스): 화면들은 esc/flash/fmtTime을 재구현하지 않고 여기에 위임한다.
 */

/** HTML escape — `& < > "` 만 이스케이프(현행 esc 그대로). */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

// 화면(root)별 토스트 타이머 — 연속 표시 시 이전 타이머를 리셋한다.
const toastTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * 토스트 표시. root 안의 `.toast`를 찾고, 없으면 만들어 붙인다.
 * 항상 role="status" aria-live="polite"를 보장하고, 이전 타이머를 리셋한다.
 */
export function showToast(root: HTMLElement, msg: string, ms = 2400): void {
  let toast = root.querySelector(".toast") as HTMLElement | null;
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.hidden = true;
    root.appendChild(toast);
  }
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = msg;
  toast.hidden = false;
  const prev = toastTimers.get(root);
  if (prev) clearTimeout(prev);
  const el = toast;
  toastTimers.set(
    root,
    setTimeout(() => {
      el.hidden = true;
    }, ms),
  );
}

/**
 * 확인 시트 — 네이티브 confirm() 대체. 파괴적 액션 앞에 세운다.
 * 네이티브 얼럿은 디자인 언어(토스 derived)와 정면으로 어긋나고 문구 통제도 안 된다.
 * 셸은 install-sheet·bookpicker와 같은 "스크림 + 하단 카드" 패턴.
 */
export function confirmSheet(opts: {
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "confirm-sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="confirm-sheet__card">
      <div class="confirm-sheet__t"></div>
      ${opts.body ? `<div class="confirm-sheet__s"></div>` : ""}
      <button class="btn-primary confirm-sheet__ok${opts.destructive ? " is-danger" : ""}"></button>
      <button class="btn-ghost confirm-sheet__cancel">취소</button>
    </div>`;
    // 제목·본문·라벨은 textContent로 — 책 제목 등 사용자 입력이 들어온다
    (el.querySelector(".confirm-sheet__t") as HTMLElement).textContent = opts.title;
    if (opts.body) {
      (el.querySelector(".confirm-sheet__s") as HTMLElement).textContent = opts.body;
    }
    const okBtn = el.querySelector(".confirm-sheet__ok") as HTMLButtonElement;
    okBtn.textContent = opts.confirmLabel;

    let done = false;
    const close = (v: boolean) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      el.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    okBtn.onclick = () => close(true);
    (el.querySelector(".confirm-sheet__cancel") as HTMLButtonElement).onclick = () => close(false);
    el.onclick = (ev) => {
      if (ev.target === el) close(false); // 스크림 탭 = 취소
    };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(el);
    okBtn.focus();
  });
}

/**
 * 시각 포맷.
 *  - "full" → `YYYY-MM-DD HH:mm` (Export/PDF/prompt)
 *  - "date" → `YYYY.MM.DD HH:mm` (detail 스탬프)
 *  - "hm"   → `HH:mm` (review 카드)
 */
export function formatTime(ts: number, style: "full" | "date" | "hm"): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (style === "hm") return hm;
  const y = d.getFullYear();
  const mo = p(d.getMonth() + 1);
  const day = p(d.getDate());
  return style === "full" ? `${y}-${mo}-${day} ${hm}` : `${y}.${mo}.${day} ${hm}`;
}
