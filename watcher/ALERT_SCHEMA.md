# coins-desk-alert/v1

JSON body POSTed to WEBHOOK_URL when a rule trips.

## Headers

| Header | Value |
|--------|--------|
| Content-Type | application/json |
| Authorization | Bearer WEBHOOK_SECRET |
| X-Desk-Secret | WEBHOOK_SECRET |

## Body fields

| Field | Type | Description |
|-------|------|-------------|
| schema | string | Always coins-desk-alert/v1 |
| ts | string | ISO-8601 UTC timestamp when the alert was built |
| source | string | Always coins-desk-watcher |
| rule | string | LIQ_DROP, TRAIL_GIVEBACK, FAST_DUMP, HARD_MINUS15, or TAKE_PROFIT_2X |
| ticker | string | Desk ticker / name |
| mint | string | Solana mint address |
| fill_usd | number or null | Position fill notional USD from fills.json |
| mark_usd | number or null | Current mark USD (price times tokens when available) |
| vs_fill_pct | number or null | Percent vs fill ((mark-fill)/fill * 100) |
| liq_usd | number or null | Current pair liquidity USD (DexScreener) |
| liq_prev_usd | number or null | Prior stored liquidity USD |
| liq_change_pct | number or null | Percent change in liquidity vs prior mark |
| price_prev_usd | number or null | Prior stored token price USD |
| note | string | Human-readable reason |
| fills_url | string | URL of fills.json used this poll |
| dex_url | string | DexScreener pair (or token) URL |

## Rules

| Rule | Condition (defaults) |
|------|----------------------|
| LIQ_DROP | liq_usd <= prior liq * (1 - 0.25) |
| TRAIL_GIVEBACK | trail armed after >= +20% vs fill; now <= +5% vs fill |
| FAST_DUMP | token priceUsd <= prior price * (1 - 0.15) |
| HARD_MINUS15 | mark <= fill * (1 - HARD_MINUS_PCT) — overnight default -15% |
| TAKE_PROFIT_2X | mark >= fill * (1 + TAKE_PROFIT_PCT) — overnight default +100% (2x) |

Thresholds are Worker vars: LIQ_DROP_PCT, TRAIL_ENABLED, TRAIL_ARM_PCT, TRAIL_EXIT_PCT, FAST_DUMP_PCT, HARD_MINUS_PCT, TAKE_PROFIT_PCT. Overnight: TRAIL_ENABLED=0, HARD_MINUS_PCT=0.15, TAKE_PROFIT_PCT=1.0.

## Deduping

KV key alert:{mint}:{rule} with TTL DEDUPE_SECONDS (default 180). While the key exists, the same rule for that mint is not re-sent.

If WEBHOOK_URL is missing, the Worker logs a dry-run payload and does not set the dedupe key and does not count the alert as sent.

## Example

```json
{
  "schema": "coins-desk-alert/v1",
  "ts": "2026-09-02T03:00:00.000Z",
  "source": "coins-desk-watcher",
  "rule": "HARD_MINUS15",
  "ticker": "RIPPY",
  "mint": "EBSd3dZyzjFrojdHAQSAsumbArGvM1nvu9zidFJypump",
  "fill_usd": 15.16,
  "mark_usd": 12.8,
  "vs_fill_pct": -15.57,
  "liq_usd": 42000,
  "liq_prev_usd": 45000,
  "liq_change_pct": -6.6667,
  "price_prev_usd": 0.011,
  "note": "mark -15.6% vs fill",
  "fills_url": "https://sparkmediaai.github.io/coins-desk/fills.json",
  "dex_url": "https://dexscreener.com/solana/..."
}
```

## Added 2026-09-04 (token-lean hunt)

| Rule | Meaning |
|------|---------|
| RIP_BENCH | Curated bench rip (clip-eligible). Extras: `m5`, `h1`, `buys_1h`, `sells_1h`, `hygiene`, buy-tilt + liq-peak gates. Cap ~25 names. |
| WATCH_NEW | Dex boosts/profiles discovery. **LOOK ONLY — do not auto-clip.** Same extras + note prefix `WATCH only`. |

### `hygiene` object

| Field | Meaning |
|-------|---------|
| program | `spl-token` / `spl-token-2022` / `unknown` |
| mintAuthority | true if mint authority still set |
| freezeAuthority | true if freeze authority still set |
| transferFeePct | Token-2022 transfer fee % if present |
| flags | e.g. `MINT_AUTH_LIVE`, `FREEZE_AUTH_LIVE`, `TOKEN_2022`, `TRANSFER_FEE_3%` |
| error | `rpc_fail` / `no_account` when check failed |

Worker vars: `WATCH_DISCOVERY_ENABLED`, `WATCH_MIN_LIQ`, `WATCH_MIN_AGE_H`, `WATCH_MAX_AGE_H`, `WATCH_MAX_BUYS_1H`, `WATCH_MAX_ALERTS`, `RIP_BENCH_BUY_TILT`, `RIP_BENCH_LIQ_DROP_PCT`, `RIP_BENCH_MAX_SIZE`, optional `SOLANA_RPC_URL`.
