/*
  Performance Throttles (copy/paste block)
  Battlefield 6 Portal (30 Hz)
  Author: mindflexor

  This matches the pattern used in Domination_ver_2.7_perf_hotfix_damage_smoothing_30hz.ts:
  - Keep critical stuff running every tick if it must (damage queue, etc.)
  - Throttle expensive "live" updates using phaseTickCount + mod.Modulo(...)

  Expected in your mode:
    - const TICK_RATE = 30;   // Portal treated as 30 ticks/sec
    - let phaseTickCount = 0; // incremented once per tick while LIVE
*/

// ---- Interval constants (same formulas as the Domination mode) ----
const TICK_RATE = 30;   // Portal treated as 30 ticks/sec
// Capture point / objective updates (Domination used "FAST" for point syncing + CP ownership/contested logic)
const LIVE_CAPTURE_UPDATE_INTERVAL_TICKS = mod.Max(1, mod.Floor(TICK_RATE / 2)); // ~15 Hz @ 30 Hz

// UI / tickets / scoreboard updates (Domination used "SLOW" for SetUITime/ChangeTickets/SetUIScores/UpdateScoreboard)
const LIVE_UI_SCORE_INTERVAL_TICKS = mod.Max(1, mod.Floor(TICK_RATE / 10)); // ~3.0 Hz @ 30 Hz

// Sound effects / announcer / suspense audio (Domination used this for endgame suspense audio)
const LIVE_SFX_INTERVAL_TICKS = mod.Max(1, mod.Floor(TICK_RATE / 3)); // ~10 Hz @ 30 Hz

//Example of implementation of Throttles in ongoing global function

let phaseTickCount: number = 0;


export function OngoingGlobal(): void {
  phaseTickCount += 1;
  if (mod.Modulo(phaseTickCount, LIVE_SFX_INTERVAL_TICKS) === 0) {
      // UpdateYourGameModeLogic();
    }

  }
// ---- Example usage (directly based on Domination) ----
// Call this from your LIVE tick loop after phaseTickCount += 1:
//
//   // Throttle expensive live updates to prevent server lag / Hz drops.
//   if (mod.Modulo(phaseTickCount, LIVE_CAPTURE_UPDATE_INTERVAL_TICKS) === 0) {
//     SyncPlayersOnPointsFromEngine();
//     Object.values(serverCapturePoints).forEach((capturePoint) => {
//       capturePoint.setOwner(mod.GetCurrentOwnerTeam(capturePoint.capturePoint));
//       UpdateCapturePointContestedState(capturePoint);
//     });
//   }
//
//   if (mod.Modulo(phaseTickCount, LIVE_SFX_INTERVAL_TICKS) === 0) {
//     UpdateEndgameSuspenseAudio(); // or any non-critical SFX/announcer logic
//   }
//
//   if (mod.Modulo(phaseTickCount, LIVE_UI_SCORE_INTERVAL_TICKS) === 0) {
//     SetUITime();
//     ChangeTickets();
//     SetUIScores();
//     UpdateScoreboard();
//   }
//
