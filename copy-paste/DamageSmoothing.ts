/*
  Damage Smoothing / Damage Spreading
  Battlefield 6 Portal (30 Hz)
  Author: mindflexor

  Purpose:
  At 30 Hz, multiple damage events can resolve in a single frame,
  causing instant 100→0 deaths. This system redistributes damage
  over a short window without changing total damage dealt.
*/

// -------------------- Tunables --------------------

const DMG_SPREAD_CLOSE_MAX_DIST = 10;
const DMG_SPREAD_MID_MAX_DIST   = 25;

const DMG_SPREAD_CLOSE_SEC = 2.0;
const DMG_SPREAD_MID_SEC   = 1.8;
const DMG_SPREAD_FAR_SEC   = 1.6;

const DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR = 0.45;
const DMG_SPREAD_HEALTH_DELAY_MAX_FACTOR = 1.0;

// -------------------- State --------------------

const dmgLastHealth: Record<number, number> = {};
const dmgQueued: Record<number, number> = {};
const dmgQueuedTicksLeft: Record<number, number> = {};
const dmgQueuedGiverObjId: Record<number, number> = {};

const dmgActive: Record<number, boolean> = {};
let dmgActiveIds: number[] = [];
const dmgIsReapplying: Record<number, boolean> = {};

// -------------------- MODE ADAPTERS --------------------
// These MUST be wired to your mode.

function dmg_isAlive(p: mod.Player): boolean { return true as unknown as boolean; }
function dmg_getPos(p: mod.Player): mod.Vector3 { return mod.Vector3(0,0,0); }
function dmg_resolvePlayerById(id: number): mod.Player | null { return null; }
function dmg_isDeployedById(id: number): boolean { return false; }
function dmg_resolvePlayerByObjId(objId: number): mod.Player | null { return null; }

// -------------------- Helpers --------------------

function secToTicks(sec: number): number {
  return mod.Max(1, mod.Ceil(sec * TICK_RATE));
}

function applyHealthScale(base: number, nh: number): number {
  const h = mod.Clamp(nh, 0, 1);
  const f = DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR +
            (DMG_SPREAD_HEALTH_DELAY_MAX_FACTOR - DMG_SPREAD_HEALTH_DELAY_MIN_FACTOR) * h;
  return mod.Max(1, mod.Ceil(base * f));
}

function pickTicks(dist: number): number {
  if (dist <= DMG_SPREAD_CLOSE_MAX_DIST) return secToTicks(DMG_SPREAD_CLOSE_SEC);
  if (dist <= DMG_SPREAD_MID_MAX_DIST)   return secToTicks(DMG_SPREAD_MID_SEC);
  return secToTicks(DMG_SPREAD_FAR_SEC);
}

function markActive(id: number) {
  if (dmgActive[id]) return;
  dmgActive[id] = true;
  dmgActiveIds.push(id);
}

function unmarkActive(id: number) {
  if (!dmgActive[id]) return;
  dmgActive[id] = false;
  const i = dmgActiveIds.indexOf(id);
  if (i >= 0) dmgActiveIds.splice(i, 1);
}

// -------------------- Public API --------------------

export function dmgSpreadTick(): void {
  for (let i = dmgActiveIds.length - 1; i >= 0; i--) {
    const id = dmgActiveIds[i];
    const victim = dmg_resolvePlayerById(id);

    if (!victim || !dmg_isAlive(victim) || !dmg_isDeployedById(id)) {
      dmgQueued[id] = 0;
      dmgQueuedTicksLeft[id] = 0;
      unmarkActive(id);
      continue;
    }

    const remaining = dmgQueued[id];
    let ticks = dmgQueuedTicksLeft[id];
    if (remaining <= 0 || ticks <= 0) {
      unmarkActive(id);
      continue;
    }

    const step = mod.Max(1, mod.Ceil(remaining / ticks));
    const giver = dmg_resolvePlayerByObjId(dmgQueuedGiverObjId[id]);

    dmgIsReapplying[id] = true;
    if (giver) mod.DealDamage(victim, step, giver);
    else mod.DealDamage(victim, step);
    dmgIsReapplying[id] = false;

    dmgQueued[id] -= step;
    dmgQueuedTicksLeft[id]--;

    if (dmgQueued[id] <= 0) unmarkActive(id);
  }
}

export function dmgSpreadOnPlayerDamaged(victim: mod.Player, attacker: mod.Player): void {
  if (!dmg_isAlive(victim)) return;

  const id = modlib.getPlayerId(victim);
  const cur = mod.GetSoldierState(victim, mod.SoldierStateNumber.CurrentHealth);

  if (dmgIsReapplying[id]) {
    dmgLastHealth[id] = cur;
    return;
  }

  if (!mod.IsPlayerValid(attacker) || mod.Equals(victim, attacker)) {
    dmgLastHealth[id] = cur;
    return;
  }

  if (mod.Equals(mod.GetTeam(victim), mod.GetTeam(attacker))) {
    dmgLastHealth[id] = cur;
    return;
  }

  const prev = dmgLastHealth[id];
  if (prev === undefined) {
    dmgLastHealth[id] = cur;
    return;
  }

  const delta = prev - cur;
  if (delta <= 0) {
    dmgLastHealth[id] = cur;
    return;
  }

  mod.Heal(victim, delta);
  dmgLastHealth[id] = prev;

  const dist = mod.DistanceBetween(dmg_getPos(victim), dmg_getPos(attacker));
  const ticks = applyHealthScale(pickTicks(dist),
    mod.GetSoldierState(victim, mod.SoldierStateNumber.NormalizedHealth));

  dmgQueued[id] = (dmgQueued[id] ?? 0) + delta;
  dmgQueuedTicksLeft[id] = ticks;
  dmgQueuedGiverObjId[id] = mod.GetObjId(attacker);

  markActive(id);
}
