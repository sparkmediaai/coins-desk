## Who wakes whom (token-lean)

- **Worker** (`coins-desk-watcher`): primary radar 24/7 — HARD_MINUS / SAVE_POINT / RIP_PLUS20 / RIP_BENCH / LIQ_DROP / BUYER_STALL / WATCH_NEW. Webhooks → Coin Trader.
- **Pages** (`sparkmedia.ai/coins-desk`): human marks only. Research pushes `fills.json` + pins Worker `FILLS_URL` **once per fill/cut**.
- **Coin Trader**: trade truth + clips. Does **not** ping-pong sync. After a fill/cut, CT states the book; Research does the one Pages/Worker pin.
- **Research**: lean hunt (silence default) + one sync pin. No overnight routine wakes.

## Sync ownership

On every fill or cut: Research updates Pages `fills.json` then pins Worker `FILLS_URL` to that commit SHA and redeploys. CT owns the chat book mark. No double-sync.

## Lean hunt (Research)

Scheduled hourly **6:00 AM–2:00 PM PT** only (silence if nothing meaningful). After 2pm: event-triggered Research only when Monitoring fires a real reason. Do not spend tokens to confirm quiet.

## RIP / WATCH

- WATCH_NEW = look only (never auto-clip).
- RIP_BENCH Worker alerts capped (`RIP_BENCH_MAX_ALERTS`); CT clips only when sleeve rules allow (25% leftover, ≥0.02 SOL reserve, entry-tax clean, skip swarm/KIRK; paused while ≥2 opens unless David stacks).

## Cursor offload

Use Cursor cloud for: Worker rule changes, dashboard/RIP panel, pair-filter bugs, deploy helpers.
Do **not** use Cursor cloud for: live tape, Dex hunts, fill narration.

## Change log

- 2026-09-04: David locked token-lean stack (Worker primary, slim hunt, one sync owner).

## Hunt upgrades (2026-09-04)

- **Worker WATCH_NEW**: Dex boosts/profiles → webhook look-only. Never auto-clip. CT decides.
- **Worker RIP_BENCH**: still curated only; max ~25 names; buy-tilt + liq-peak gates; mint/freeze/Token-2022 fee flags on alerts.
- **Hygiene**: mint authority / freeze / transfer fee checked via Solana RPC (cached 6h). Dirty flags in the alert note.
- Research lean hunt stays silence-default backup — does not replace Worker discovery.

## Locked 2026-09-04 ~6:40 PM PT (probe / WATCH)

- New fills / probes / RIP clips until **7:00 PM PT** (was 4:00). 8:00 PM overnight flatten unchanged.
- Hourly chat desk prints **OFF** — dashboard owns marks.
- Classification: STRONG / DEVELOPING (probe ≤12% book) / WATCH / REJECT.
- DEVELOPING floors: liq ≥$50k, age ≥45m post-grad, hard safety first.
- Promotion Gate: ≥5/8 evidence + ≥25m. Never average down.
- Full rules: Drive “Live Desk Rules — locked 2026-09-04 evening (probe/WATCH)” + `/workspace/live-desk/playbook.md`.

## Monitor vs Research (2026-09-04 ~7:20 PM PT)

- **Monitoring** = Worker, 24/7 (cuts, liq, RIP, WATCH_NEW). Never shut off.
- **Scheduled Research** = top of hour **6:00 AM–2:00 PM PT** only. Silence if nothing changed.
- **After 2pm:** Research only on real Monitoring triggers (not minor tape noise).
- **4pm LOOK** = CT book review, not a Research market sweep.
- New clips still stop at **7:00 PM PT**; overnight flatten 8pm unchanged.


## fills.json push rule (locked 2026-09-05)

**NEVER** commit stub `fills.json` (stub markers (`PLA`+`CEHOLDER*`, `LOAD_FROM:/tmp/...`)). Always push the **full valid JSON** in one commit. Stub tips break Pages (ERROR pill) until restored. CI `fills-guard` rejects stubs on `main`.
