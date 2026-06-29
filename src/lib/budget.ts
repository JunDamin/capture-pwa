/**
 * Capture Loop Budget instrumentation — PRD §16, ADR-001 보강.
 * 목표: 카메라 웜업 ≤ 1000ms, 캡처 1회 완료 p95 ≤ 3000ms.
 * 이 수치는 표어가 아니라 예산이다 → 항상 측정해서 화면에 노출한다.
 */

export const BUDGET = {
  warmupMs: 1000,
  captureMs: 3000,
} as const;

const now = () => performance.now();

export function time<T>(fn: () => T): { value: T; ms: number };
export function time<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }>;
export function time<T>(fn: () => T | Promise<T>): any {
  const t0 = now();
  const r = fn();
  if (r instanceof Promise) {
    return r.then((value) => ({ value, ms: now() - t0 }));
  }
  return { value: r, ms: now() - t0 };
}

/** 단순 스톱워치 — 시작 시점을 잡아 두고 stop()으로 경과(ms)를 읽는다. */
export class Stopwatch {
  private t0 = now();
  reset() {
    this.t0 = now();
  }
  stop() {
    return now() - this.t0;
  }
}

export interface BudgetSample {
  warmupMs?: number;
  captureMs?: number;
  compressMs?: number;
  sizeKB?: number;
}

const samples: BudgetSample[] = [];

export function record(sample: BudgetSample) {
  samples.push(sample);
}

export function getSamples() {
  return samples.slice();
}

/** p95 (작은 표본에선 max에 수렴) — 회귀 감시용. */
export function p95(values: number[]): number | undefined {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const idx = Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1);
  return v[idx];
}

export function within(ms: number, budget: number) {
  return ms <= budget;
}
