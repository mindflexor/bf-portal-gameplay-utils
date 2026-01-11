# bf-portal-gameplay-utils

Reusable gameplay and performance utilities for **Battlefield 6 Portal** modes.

This repository provides **copy-paste friendly**, single-file compatible tools
designed specifically for **30 Hz Battlefield 6 Portal servers**, where custom
modes can suffer from performance pressure and overly bursty combat.

## Included tools

### Performance Throttles
Simple tick-based helpers to reduce per-frame script cost and stabilize server performance.

### Damage Smoothing
A gameplay utility that redistributes damage over a short window to improve
combat readability at 30 Hz without changing total damage dealt.

## Design goals
- Battlefield 6 Portal only (not BF2042)
- Single-file mode compatibility (no imports required)
- Explicit, readable logic
- Predictable performance characteristics
- Clear gameplay trade-offs

## How to use
Each tool lives in `copy-paste/` as a self-contained TypeScript block.

1. Open the file
2. Paste it into your Portal mode script
3. Fill in the small adapter functions marked in comments
4. Call the provided functions from your tick loop / events

## License & credit
Created by **mindflexor**.  
MIT licensed — free to use with attribution appreciated.
