# coins-desk-watcher (alert-only)

Cloudflare Worker that polls open positions from Pages `fills.json`, marks them on DexScreener, and POSTs a webhook when a playbook trip fires.

**No wallet keys. No auto-sell. Alert-only.**

Coin Trader verifies the alert, then cuts. Research owns this Worker + Pages blotter.

## Cost

- Cloudflare **Workers Paid ~$5/mo** (Free 10ms CPU is too tight).
- Start with **1-min cron** (`* * * * *`).
- Follow-up: Durable Object alarm loop ~15s on the same plan (~$5–10 total).

## Alert schema

See [ALERT_SCHEMA.md](./ALERT_SCHEMA.md) (`coins-desk-alert/v1`).

### Trip rules (defaults)

| Rule | Default |
|------|---------|
| `LIQ_DROP` | liq −25% vs last print |
| `TRAIL_GIVEBACK` | was ≥+20% vs fill, now ≤+5% vs fill |
| `FAST_DUMP` | price −15% vs last print in one poll |
| `HARD_MINUS10` | mark ≤ −10% vs fill |

## Deploy

1. Cloudflare account + **Workers Paid** when billing asks. David adds the card in the CF dashboard — never paste card numbers in chat.
2. Invite `daveatdigital@gmail.com` / `sparkmediaai@gmail.com` under Members as needed.
3. From this folder:

```bash
cd watcher
npm i
npx wrangler login
npx wrangler kv namespace create DESK_STATE
npx wrangler kv namespace create DESK_STATE --preview
# paste both ids into wrangler.toml
npx wrangler secret put WEBHOOK_URL
npx wrangler secret put WEBHOOK_SECRET
npx wrangler deploy
```

4. Health: `GET https://coins-desk-watcher.<subdomain>.workers.dev/health`
5. Manual poll: `POST /run` with the same bearer secret.

## Grok Bot (Coin Trader)

Create a **webhook** routine for `coins-desk-alert/v1`, post into Coins, verify → cut. Put that URL in `WEBHOOK_URL`.

## Follow-ups

- Durable Object ~15s self-wake
- Peak trail if David locks it
