# Performance Throttles (BF6 Portal, 30 Hz)

## Why this exists
Battlefield 6 Portal servers run at **30 Hz**. Any logic executed every tick directly impacts server stability.
Many custom modes accidentally run expensive loops every tick (players, objectives, vehicles, UI), causing Hz drops,
desync, and unstable gunfights.

This utility provides a **simple, explicit pattern** for controlling how often different categories of logic run.

## Cadence buckets
Instead of running everything every tick, divide work into buckets:

- **fast** (~10 Hz): important but not per-tick critical logic
- **captureLogic** (~6 Hz): capture point/objective evaluation + bookkeeping
- **uiScores** (~3 Hz): match time counter + player scores UI refresh
- **sfx** (~2 Hz): non-critical sound effects / announcer / ambience triggers

These defaults are tuned for **30 Hz** but scale from the provided tick rate.

## API

### `perfMakeCadence(tickRate)`
Creates an object of tick intervals.

Example @ 30 Hz:
- fast: 3 ticks
- captureLogic: 5 ticks
- uiScores: 10 ticks
- sfx: 15 ticks

### `perfEveryTicks(tickCount, intervalTicks)`
Returns true when it’s time to run that bucket.

```ts
const perf = perfMakeCadence(TICK_RATE);

if (perfEveryTicks(phaseTickCount, perf.captureLogic)) {
  // capture point logic
}

if (perfEveryTicks(phaseTickCount, perf.uiScores)) {
  // update match timer + scoreboard widgets
}

if (perfEveryTicks(phaseTickCount, perf.sfx)) {
  // non-critical audio triggers
}
```

### `perfRoundRobinSlice(items, cursor, maxPerExec)` (optional)
Spreads heavy work across multiple execution ticks.

Common use:
- Evaluate 1–2 capture points per execution instead of all points at once
- Iterate vehicles in batches

```ts
let cursor = 0;

if (perfEveryTicks(phaseTickCount, perf.captureLogic)) {
  const { slice, nextCursor } = perfRoundRobinSlice(capturePoints, cursor, 2);
  cursor = nextCursor;

  for (const cp of slice) {
    // update cp
  }
}
```

## What to throttle
Good candidates:
- Objective evaluation
- AI behaviors (non-critical)
- Score aggregation
- UI refreshes (time/score widgets)
- Audio triggers

Avoid throttling:
- Damage processing
- Death validation
- Time-critical state transitions
- Input-adjacent logic (if applicable)

## Philosophy
These helpers don’t hide performance costs — they make them **visible and intentional**.
