# Coins desk — who wakes whom (token-lean)

Goal: react fast on real exits/rips; keep agent tokens for decisions, not polling.

## Stack

| Layer | Job | Cost |
|---|---|---|
| **Cloudflare Worker** (`coins-desk-watcher`) | Primary radar. Polls fills + Dex ~1m. HARD_MINUS, SAVE_POINT / trail ladder, RIP_PLUS20, RIP_BENCH, LIQ_DROP, buyer-stall. Webhook → CT. | Cheap (CF) |
| **GitHub Pages dashboard** | Human glance for marks / RIP_BENCH panel. | Free |
| **Coin Trader** | Trades, tape prints, local fills, acts on Worker alerts. | Agent tokens |
| **Research** | Pages `fills.json` push + Worker `FILLS_URL` pin; cut/RIP flags only when needed; code fixes via Cursor cloud. | Agent tokens |
| **Cursor cloud** | Repo/code only (Worker rules, dashboard UI). Not tape. | Separate |

## Who wakes whom

1. **Worker alert** → CT (webhook). CT prints + fills/cuts on-chain.
2. **CT fill/cut** → Research syncs Pages + pins Worker (one message with numbers or commit SHA). Research does **not** re-poll Dex to restate the print.
3. **Research lean hunt** (3× daily-ish: 8:19 / 11:19 / 2:19 / 5:19 / 8:19 PT) → **silent** unless cut flag / RIP / drift. No book recaps.
4. **David** → either agent for overrides (stack, ban, trail change). Agents do not fan out.

## Sync ownership (one owner)

- **CT** writes the trade truth (tokens, SOL, tx, leftover, flags) and may commit `fills.json`.
- **Research** makes tip + Worker match that truth (push if needed, always pin `FILLS_URL` to the tip commit SHA).
- Never two parallel “sync both” threads. If tip already matches, Research replies once and stops.
- Open mints off `rip_bench` while held; cuts return to bench (not banned) unless David bans.

## Silence defaults

- No overnight agent wakes (after ~8:19 PM PT). Worker may still watch.
- No “still holding QENIS at +X%” posts.
- RIP_BENCH Worker alerts capped (`RIP_BENCH_MAX_ALERTS`); CT clips only when sleeve rules allow (25% leftover, ≥0.02 SOL reserve, entry-tax clean, skip swarm/KIRK; paused while ≥2 opens unless David stacks).

## Cursor offload

Use Cursor cloud for: Worker rule changes, dashboard/RIP panel, pair-filter bugs, deploy helpers.
Do **not** use Cursor cloud for: live tape, Dex hunts, fill narration.

## Change log

- 2026-09-04: David locked token-lean stack (Worker primary, slim hunt, one sync owner).
