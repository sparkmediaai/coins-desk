# Coins desk — who wakes whom (token-lean)

Goal: react fast on real exits/rips; keep agent tokens for decisions, not polling.

## Stack

| Layer | Job | Cost |
|---|---|---|
| **Cloudflare Worker** (`coins-desk-watcher`) | Primary radar. Polls fills + Dex ~1m. HARD_MINUS, SAVE_POINT / trail ladder, RIP_PLUS20, RIP_BENCH, LIQ_DROP, buyer-stall, WATCH_NEW. Webhook → CT. | Cheap (CF) |
| **GitHub Pages dashboard** | Human glance for marks / RIP_BENCH panel. Replaces hourly chat desk prints. | Free |
| **Coin Trader** | Trades, tape prints, local fills, acts on Worker alerts. Probes/adds. | Agent tokens |
| **Research** | Pages `fills.json` push + Worker `FILLS_URL` pin; classify STRONG/DEVELOPING/WATCH/REJECT; cut/RIP flags only when needed; code via Cursor cloud. | Agent tokens |
| **Cursor cloud** | Repo/code only (Worker rules, dashboard UI). Not tape. | Separate |

## Who wakes whom

1. **Worker alert** → CT (webhook). CT prints + fills/cuts on-chain.
2. **CT fill/cut** → Research syncs Pages + pins Worker (one message with numbers or commit SHA). Research does **not** re-poll Dex to restate the print.
3. **Research lean hunt** (8:19 / 11:19 / 2:19 / 5:19 / 8:19 PT) → **silent** unless cut flag / RIP / drift / WATCH trigger. No book recaps.
4. **David** → either agent for overrides (stack, ban, trail change). Agents do not fan out.

## Sync ownership (one owner)

- **CT** writes the trade truth (tokens, SOL, tx, leftover, flags) and may commit `fills.json`.
- **Research** makes tip + Worker match that truth (push if needed, always pin `FILLS_URL` to the tip commit SHA).
- Never two parallel “sync both” threads. If tip already matches, Research replies once and stops.
- Open mints off `rip_bench` while held; cuts return to bench (not banned) unless David bans.

## Silence defaults

- No overnight agent wakes (after ~8:19 PM PT). Worker may still watch.
- No hourly book-mark chat (dashboard owns marks).
- No “still holding QENIS at +X%” posts.
- RIP_BENCH Worker alerts capped (`RIP_BENCH_MAX_ALERTS`); CT clips only when sleeve rules allow (25% leftover, ≥0.02 SOL reserve, entry-tax clean, skip swarm/KIRK; paused while ≥2 opens unless David stacks).
- New fills / probes / RIP clips stop at **7:00 PM PT**. 8:00 PM overnight flatten if still red.

## Locked 2026-09-04 ~6:40 PM PT (probe / WATCH)

- Classification: STRONG / DEVELOPING (probe ≤12% book) / WATCH / REJECT.
- DEVELOPING floors: liq ≥$50k, age ≥45m post-grad, hard safety first.
- Promotion Gate: ≥5/8 evidence + ≥25m. Never average down.
- Full rules: Drive “Live Desk Rules — locked 2026-09-04 evening (probe/WATCH/7pm)” + `/workspace/live-desk/playbook.md`.

## Cursor offload

Use Cursor cloud for: Worker rule changes, dashboard/RIP panel, pair-filter bugs, deploy helpers.
Do **not** use Cursor cloud for: live tape, Dex hunts, fill narration.

## Hunt upgrades (2026-09-04)

- **Worker WATCH_NEW**: Dex boosts/profiles → webhook look-only. Never auto-clip. CT decides.
- **Worker RIP_BENCH**: still curated only; max ~25 names; buy-tilt + liq-peak gates; mint/freeze/Token-2022 fee flags on alerts.
- **Hygiene**: mint authority / freeze / transfer fee checked via Solana RPC (cached 6h). Dirty flags in the alert note.
- Research lean hunt stays silence-default backup — does not replace Worker discovery.

## Change log

- 2026-09-04 evening: probe/WATCH tiers; 7pm new-entry clock; hourly chat desk off.
- 2026-09-04 afternoon: token-lean stack; WATCH_NEW; RIP hygiene/buy-tilt; slim hunt.
