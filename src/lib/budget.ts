/**
 * Capture Loop Budget instrumentation — PRD §16, ADR-001 보강.
 * 목표: 카메라 웜업 ≤ 1000ms, 앱이 끼어드는 시간(appMs) ≤ 300ms (ADR-011).
 * 이 수치는 표어가 아니라 예산이다 → 항상 측정해서 화면에 노출한다.
 */

export const BUDGET = {
  warmupMs: 1000,
  // 앱이 끼어든 시간(셔터 동결 + 저장 커밋·복귀)의 합. 사람 판단 시간은 제외.
  // PRD §16의 본뜻 = "앱이 끼어드는 시간이 짧다". (실기기 측정으로 재정의 — ADR-011)
  appMs: 300,
} as const;

const now = () => performance.now();

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
  appMs?: number; // 앱 지연 합 (셔터 동결 + 저장 커밋·복귀)
  humanMs?: number; // 사람 판단 시간 (참고용 — 합격/불합격 아님)
  captureMs?: number; // 셔터→저장 총합 (사람 포함)
  compressMs?: number;
  sizeKB?: number;
}

const samples: BudgetSample[] = [];

export function record(sample: BudgetSample) {
  samples.push(sample);
}

export function within(ms: number, budget: number) {
  return ms <= budget;
}
