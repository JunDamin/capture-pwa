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
