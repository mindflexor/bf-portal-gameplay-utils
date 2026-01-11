# Damage Smoothing (BF6 Portal, 30 Hz)

## Why this exists
Battlefield 6 Portal servers currently operate at 30 Hz.
In high-action custom modes, multiple damage events may resolve in the same frame,
leading to instant 100→0 deaths.

This system preserves total damage while redistributing it over time,
improving combat readability.

## When to use this

**Good fits**
- Arcade modes with longer-feeling TTK
- PvE / boss encounters
- Modes where readability is preferred over instant lethality
- High-action Portal modes affected by 30 Hz update granularity

**Be careful with**
- Competitive or hardcore modes
- Burst-dominant balance targets
- Very high rate-of-fire lobbies (adds extra DealDamage calls)
