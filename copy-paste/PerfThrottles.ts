/*
  Performance Throttles
  Battlefield 6 Portal (30 Hz)
  Author: mindflexor
*/

export function perfMakeLiveIntervals(tickRate: number) {
  return {
    fast: mod.Max(1, mod.Floor(tickRate / 10)),
    slow: mod.Max(1, mod.Floor(tickRate / 3)),
    endgameAudio: mod.Max(1, mod.Floor(tickRate / 2)),
  };
}

export function perfEveryTicks(tickCount: number, intervalTicks: number): boolean {
  const n = mod.Max(1, mod.Floor(intervalTicks));
  return mod.Modulo(tickCount, n) === 0;
}
