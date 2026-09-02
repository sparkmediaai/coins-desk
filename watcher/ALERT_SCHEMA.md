# coins-desk-alert/v1

Alert-only webhook payload from `coins-desk-watcher`.

```json
{
  "schema": "coins-desk-alert/v1",
  "ts": "2026-09-01T20:00:00.000Z",
  "source": "coins-desk-watcher",
  "rule": "LIQ_DROP|TRAIL_GIVEBACK|FAST_DUMP|HARD_MINUS10",
  "ticker": "RIPPY",
  "mint": "...",
  "fill_usd": 15.16,
  "mark_usd": 12.0,
  "vs_fill_pct": -20.8,
  "liq_usd": 90000,
  "liq_prev_usd": 130000,
  "liq_change_pct": -30.8,
  "price_prev_usd": 14.0,
  "note": "one line",
  "fills_url": "https://sparkmediaai.github.io/coins-desk/fills.json",
  "dex_url": "https://dexscreener.com/solana/<mint>"
}
```

Auth: `Authorization: Bearer <WEBHOOK_SECRET>` and `X-Desk-Secret: <WEBHOOK_SECRET>`.
