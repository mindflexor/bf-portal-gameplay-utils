/*
  Performance Throttles
  Battlefield 6 Portal (30 Hz)
  Author: mindflexor

  Goal:
  Provide consistent, mode-friendly tick cadences so creators stop running
  expensive loops every tick. Designed for single-file Portal scripts.

  Usage pattern:
    const perf = perfMakeCadence(TICK_RATE);

    if (perfEveryTicks(phaseTickCount, perf.captureLogic)) { ... }
    if (perfEveryTicks(phaseTickCount, perf.uiScores)) { ... }
    if (perfEveryTicks(phaseTickCount, perf.sfx)) { ... }
*/

export type PerfCadence = {
  /** High-frequency gameplay checks that still shouldn't run every tick. (~10 Hz @ 30 Hz) */
  fast: number;

  /** Capture point / objective evaluation and related bookkeeping. (~6 Hz @ 30 Hz) */
  captureLogic: number;

  /** Match timer + player score UI refresh cadence. (~3 Hz @ 30 Hz) */
  uiScores: number;

  /** Non-critical SFX / announcer / ambience triggers. (~2 Hz @ 30 Hz) */
  sfx: number;
};

/**
 * Creates common cadence intervals (in ticks) from the server tick rate.
 * Values are clamped to at least 1 tick.
 *
 * Defaults are tuned for BF6 Portal @ 30 Hz:
 *  - fast        : 3 ticks  (~10 Hz)
 *  - captureLogic: 5 ticks  (~6 Hz)
 *  - uiScores    : 10 ticks (~3 Hz)
 *  - sfx         : 15 ticks (~2 Hz)
 */
export function perfMakeCadence(tickRate: number): PerfCadence {
  const safe = (n: number) => mod.Max(1, mod.Floor(n));

  return {
    fast: safe(tickRate / 10),
    captureLogic: safe(tickRate / 6),
    uiScores: safe(tickRate / 3),
    sfx: safe(tickRate / 2),
  };
}

/**
 * Returns true when the current tick is an execution tick for the interval.
 */
export function perfEveryTicks(tickCount: number, intervalTicks: number): boolean {
  const n = mod.Max(1, mod.Floor(intervalTicks));
  return mod.Modulo(tickCount, n) === 0;
}

/**
 * Optional helper: run a fixed number of items per execution tick (round-robin).
 * Useful for distributing heavy work like scanning objectives or vehicles.
 */
export function perfRoundRobinSlice<T>(items: T[], cursor: number, maxPerExec: number): { slice: T[]; nextCursor: number } {
  const n = mod.Max(1, mod.Floor(maxPerExec));
  if (items.length === 0) return { slice: [], nextCursor: 0 };

  const out: T[] = [];
  let c = cursor;

  for (let i = 0; i < n; i++) {
    out.push(items[c]);
    c++;
    if (c >= items.length) c = 0;
  }

  return { slice: out, nextCursor: c };
}
