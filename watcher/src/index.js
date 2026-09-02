/**
 * coins-desk-watcher — alert-only.
 * Polls fills.json open positions + DexScreener; POSTs webhook on trip.
 * No wallet keys. No auto-sell.
 *
 * Secrets (wrangler secret put):
 *   WEBHOOK_URL
 *   WEBHOOK_SECRET
 */

const SCHEMA = "coins-desk-alert/v1";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health" || url.pathname === "/") {
      const last = await env.DESK_STATE.get("last_poll_meta", { type: "json" });
      return json({
        ok: true,
        service: "coins-desk-watcher",
        mode: "alert-only",
        last_poll: last || null,
      });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.WEBHOOK_SECRET || auth !== `Bearer ${env.WEBHOOK_SECRET}`) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const result = await pollOnce(env);
      return json(result);
    }
    return json({ ok: false, error: "not_found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(pollOnce(env));
  },
};

async function pollOnce(env) {
  const fillsUrl = env.FILLS_URL || "https://sparkmediaai.github.io/coins-desk/fills.json";
  const thresholds = {
    liqDrop: num(env.LIQ_DROP_PCT, 0.25),
    trailArm: num(env.TRAIL_ARM_PCT, 0.2),
    trailExit: num(env.TRAIL_EXIT_PCT, 0.05),
    fastDump: num(env.FAST_DUMP_PCT, 0.15),
    hardMinus: num(env.HARD_MINUS_PCT, 0.1),
    dedupeSec: num(env.DEDUPE_SECONDS, 180),
  };

  let fills;
  try {
    const r = await fetch(fillsUrl, { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!r.ok) throw new Error(`fills HTTP ${r.status}`);
    fills = await r.json();
  } catch (e) {
    return { ok: false, error: `fills_fetch: ${String(e)}` };
  }

  const positions = Array.isArray(fills.positions) ? fills.positions : [];
  const alerts = [];
  const marks = {};

  for (const pos of positions) {
    const mint = pos.mint;
    const ticker = pos.ticker || (mint ? mint.slice(0, 6) : "?");
    if (!mint) continue;

    const fillUsd = Number(pos.fill_usd);
    if (!Number.isFinite(fillUsd) || fillUsd <= 0) continue;

    const dex = await fetchDexMark(mint);
    if (!dex) {
      marks[mint] = { error: "dex_miss", ticker };
      continue;
    }

    const markUsd = dex.priceUsd;
    const liqUsd = dex.liquidityUsd;
    const vsFill = (markUsd - fillUsd) / fillUsd;

    const stateKey = `mark:${mint}`;
    const prev = (await env.DESK_STATE.get(stateKey, { type: "json" })) || {};
    const armed = prev.trail_armed === true || vsFill >= thresholds.trailArm;
    const next = {
      ticker,
      mint,
      mark_usd: markUsd,
      liq_usd: liqUsd,
      vs_fill_pct: vsFill,
      trail_armed: armed,
      updated_at: new Date().toISOString(),
    };

    const trips = [];

    if (
      Number.isFinite(prev.liq_usd) &&
      prev.liq_usd > 0 &&
      Number.isFinite(liqUsd) &&
      (prev.liq_usd - liqUsd) / prev.liq_usd >= thresholds.liqDrop
    ) {
      trips.push({
        rule: "LIQ_DROP",
        note: `liq drop vs last print`,
      });
    }

    if (armed && vsFill <= thresholds.trailExit) {
      trips.push({
        rule: "TRAIL_GIVEBACK",
        note: `trail giveback vs fill`,
      });
    }

    if (
      Number.isFinite(prev.mark_usd) &&
      prev.mark_usd > 0 &&
      (prev.mark_usd - markUsd) / prev.mark_usd >= thresholds.fastDump
    ) {
      trips.push({
        rule: "FAST_DUMP",
        note: `fast dump vs last print`,
      });
    }

    if (vsFill <= -thresholds.hardMinus) {
      trips.push({
        rule: "HARD_MINUS10",
        note: `hard minus vs fill`,
      });
    }

    for (const t of trips) {
      const dedupeKey = `alert:${mint}:${t.rule}`;
      const lastFire = Number((await env.DESK_STATE.get(dedupeKey)) || 0);
      const now = Date.now();
      if (now - lastFire < thresholds.dedupeSec * 1000) continue;

      const payload = {
        schema: SCHEMA,
        ts: new Date().toISOString(),
        source: "coins-desk-watcher",
        rule: t.rule,
        ticker,
        mint,
        fill_usd: fillUsd,
        mark_usd: markUsd,
        vs_fill_pct: round4(vsFill * 100),
        liq_usd: liqUsd,
        liq_prev_usd: prev.liq_usd ?? null,
        liq_change_pct:
          Number.isFinite(prev.liq_usd) && prev.liq_usd > 0
            ? round4(((liqUsd - prev.liq_usd) / prev.liq_usd) * 100)
            : null,
        price_prev_usd: prev.mark_usd ?? null,
        note: t.note,
        fills_url: fillsUrl,
        dex_url: `https://dexscreener.com/solana/${mint}`,
      };

      const sent = await postWebhook(env, payload);
      if (sent) {
        await env.DESK_STATE.put(dedupeKey, String(now));
        alerts.push(payload);
      }
    }

    await env.DESK_STATE.put(stateKey, JSON.stringify(next));
    marks[mint] = next;
  }

  const meta = {
    ts: new Date().toISOString(),
    open: positions.length,
    alerts: alerts.length,
  };
  await env.DESK_STATE.put("last_poll_meta", JSON.stringify(meta));
  return { ok: true, ...meta, alerts, marks };
}

async function fetchDexMark(mint) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!r.ok) return null;
    const data = await r.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const sol = pairs.filter((p) => (p.chainId || "").toLowerCase() === "solana");
    const pool = (sol.length ? sol : pairs)
      .slice()
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!pool) return null;
    const priceUsd = Number(pool.priceUsd);
    const liquidityUsd = Number(pool.liquidity?.usd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
    return {
      priceUsd,
      liquidityUsd: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
      pairAddress: pool.pairAddress,
    };
  } catch {
    return null;
  }
}

async function postWebhook(env, payload) {
  if (!env.WEBHOOK_URL) {
    console.log("WEBHOOK_URL unset; alert dry-run", payload.rule, payload.ticker);
    return false;
  }
  const headers = { "content-type": "application/json" };
  if (env.WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${env.WEBHOOK_SECRET}`;
    headers["X-Desk-Secret"] = env.WEBHOOK_SECRET;
  }
  const r = await fetch(env.WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.log("webhook failed", r.status, await r.text());
    return false;
  }
  return true;
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
