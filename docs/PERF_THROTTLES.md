# Performance Throttles (BF6 Portal, 30 Hz)

This documentation follows the exact pattern used in the Domination mode
(`Domination_ver_2.7_perf_hotfix_damage_smoothing_30hz.ts`).

## Why this exists
Battlefield 6 Portal servers currently run at **30 Hz**. If a script does expensive work every tick,
server Hz can drop and gunfights can feel inconsistent.

The Domination mode solves this by:
- Running only truly time-critical logic every tick
- Throttling heavier updates using `phaseTickCount` + `mod.Modulo(...)`

## Intervals (same formulas as Domination)

```ts
const LIVE_CAPTURE_UPDATE_INTERVAL_TICKS = mod.Max(1, mod.Floor(TICK_RATE / 3)); // ~10 Hz
const LIVE_UI_SCORE_INTERVAL_TICKS       = mod.Max(1, mod.Floor(TICK_RATE / 10));  // ~3.0 Hz
const LIVE_SFX_INTERVAL_TICKS            = mod.Max(1, mod.Floor(TICK_RATE / 2));  // ~1.5 Hz
```

### What each bucket is for

- **LIVE_CAPTURE_UPDATE_INTERVAL_TICKS (~10 Hz)**  
  Capture points / objective evaluation, contested state, syncing players on points.

- **LIVE_UI_SCORE_INTERVAL_TICKS (~3.3 Hz)**  
  Match timer counter, tickets, player scores UI, scoreboard refresh.

- **LIVE_SFX_INTERVAL_TICKS (~2 Hz)**  
  Non-critical sound effects, announcer triggers, ambience, suspense audio.

## Example usage (from Domination)

```ts
// Throttle expensive live updates to prevent server lag / Hz drops.
if (mod.Modulo(phaseTickCount, LIVE_CAPTURE_UPDATE_INTERVAL_TICKS) === 0) {
  SyncPlayersOnPointsFromEngine();

  Object.values(serverCapturePoints).forEach((capturePoint) => {
    capturePoint.setOwner(mod.GetCurrentOwnerTeam(capturePoint.capturePoint));
    UpdateCapturePointContestedState(capturePoint);
  });
}

if (mod.Modulo(phaseTickCount, LIVE_SFX_INTERVAL_TICKS) === 0) {
  UpdateEndgameSuspenseAudio();
}

if (mod.Modulo(phaseTickCount, LIVE_UI_SCORE_INTERVAL_TICKS) === 0) {
  SetUITime();
  ChangeTickets();
  SetUIScores();
  UpdateScoreboard();
}
```

## Notes
- These throttles are intentionally simple and explicit.
- They are designed for **single-file Portal scripts** (copy/paste friendly).
- Keep damage processing / death validation on per-tick or event-based logic.
