# Coins desk — who wakes whom (token-lean)

Goal: react fast on real exits/rips; keep agent tokens for decisions, not polling.

## Stack

| Layer | Job | Cost |
|---|---|---|
| **Cloudflare Worker** (`coins-desk-watcher`) | **MONITORING 24/7.** Polls fills + Dex ~1m. HARD_MINUS, SAVE_POINT / trail ladder, RIP_PLUS20, RIP_BENCH, LIQ_DROP, buyer-stall, WATCH_NEW. Webhook → CT. | Cheap (CF) |
| **GitHub Pages dashboard** | Human glance for marks / RIP_BENCH panel. Replaces hourly chat desk prints. | Free |
| **Coin Trader** | Trades, tape prints, local fills, acts on Worker alerts. Probes/adds. 4pm LOOK. | Agent tokens |
| **Research** | Scheduled Research 6 AM–2 PM PT; event-triggered after; Pages `fills.json` + Worker pin; classify STRONG/DEVELOPING/WATCH/REJECT. | Agent tokens |
| **Cursor cloud** | Repo/code only (Worker rules, dashboard UI). Not tape. | Separate |

## Who wakes whom

1. **Worker alert** → CT (webhook). CT prints + fills/cuts on-chain. May wake Research only if deeper analysis needed.
2. **CT fill/cut** → Research syncs Pages + pins Worker (one message with numbers or commit SHA). Research does **not** re-poll Dex to restate the print.
3. **Scheduled Research** (top of hour **6:00 AM–2:00 PM PT**) → **silent** unless meaningful new candidate / WATCH trigger fire / cut flag / RIP / drift. No book recaps. Do not spend tokens to confirm quiet.
4. **After 2:00 PM PT:** no routine Research. Event-triggered Research only when Monitoring detects a real reason (WATCH graduate/liq threshold, strong new tape, ambiguous open, credible post-cut replacement, etc.).
5. **4:00 PM LOOK** → CT book review (not a Research market sweep).
6. **David** → either agent for overrides. Agents do not fan out.

## Sync ownership (one owner)

- **CT** writes the trade truth (tokens, SOL, tx, leftover, flags) and may commit `fills.json`.
- **Research** makes tip + Worker match that truth (push if needed, always pin `FILLS_URL` to the tip commit SHA).
- Never two parallel “sync both” threads. If tip already matches, Research replies once and stops.
- Open mints off `rip_bench` while held; cuts return to bench (not banned) unless David bans.

## Silence defaults

- Monitoring (Worker) never sleeps.
- No scheduled Research after 2:00 PM PT; no overnight Research chatter.
- No hourly book-mark chat (dashboard owns marks).
- No “still holding …” posts.
- RIP_BENCH Worker alerts capped; CT clips only when sleeve rules allow (25% leftover, ≥0.02 SOL reserve, entry-tax clean, skip swarm/KIRK; paused while ≥2 opens unless David stacks).
- New fills / probes / RIP clips stop at **7:00 PM PT**. 8:00 PM overnight flatten if still red.

## Locked 2026-09-04 ~6:40 PM PT (probe / WATCH)

- Classification: STRONG / DEVELOPING (probe ≤12% book) / WATCH / REJECT.
- DEVELOPING floors: liq ≥$50k, age ≥45m post-grad, hard safety first.
- Promotion Gate: ≥5/8 evidence + ≥25m. Never average down.
- Full rules: Drive evening lock + `/workspace/live-desk/playbook.md`.

## Monitor vs Research (2026-09-04 ~7:20 PM PT)

- **MONITOR 24/7** (Worker).
- **SCHEDULED RESEARCH:** hourly 6 AM–2 PM PT.
- **OUTSIDE THAT WINDOW:** Research only when Monitoring detects a real reason.
- Do not spend tokens to confirm that nothing changed.

## Cursor offload

Use Cursor cloud for: Worker rule changes, dashboard/RIP panel, pair-filter bugs, deploy helpers.
Do **not** use Cursor cloud for: live tape, Dex hunts, fill narration.

## Hunt upgrades (2026-09-04)

- **Worker WATCH_NEW**: Dex boosts/profiles → webhook look-only. Never auto-clip. CT decides.
- **Worker RIP_BENCH**: still curated only; max ~25 names; buy-tilt + liq-peak gates; mint/freeze/Token-2022 fee flags on alerts.
- **Hygiene**: mint authority / freeze / transfer fee checked via Solana RPC (cached 6h).
- Scheduled Research does not replace Worker discovery.

## Change log

- 2026-09-04 ~7:20 PM: Monitor 24/7 vs Research 6 AM–2 PM; event-only after 2pm.
- 2026-09-04 evening: probe/WATCH tiers; 7pm new-entry clock; hourly chat desk off.
- 2026-09-04 afternoon: token-lean stack; WATCH_NEW; RIP hygiene/buy-tilt; slim hunt.
