/**
 * coins-desk-watcher — alert-only Cloudflare Worker
 * Polls fills.json + DexScreener, trips rules, POSTs webhook alerts.
 * No auto-sell. Secrets via wrangler secret only (never in this file).
 */

const SCHEMA = "coins-desk-alert/v1";
const SOURCE = "coins-desk-watcher";
const DEX_TOKEN_URL = "https://api.dexscreener.com/latest/dex/tokens/";
const DEX_BOOSTS_URL = "https://api.dexscreener.com/token-boosts/top/v1";
const DEX_PROFILES_URL = "https://api.dexscreener.com/token-profiles/latest/v1";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const QUOTE_OK = new Set([WSOL.toLowerCase(), USDC.toLowerCase()]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && (path === "/" || path === "/health")) {
      const lastPoll = await env.DESK_STATE.get("last_poll");
      const ripEnabled = String(env.RIP_ENABLED ?? "0") === "1";
      const liqDrop = num(env.LIQ_DROP_PCT, 0.3) > 0;
      const buyerStall = String(env.BUYER_STALL_ENABLED ?? "1") !== "0";
      const ghostScrub = String(env.GHOST_SCRUB ?? "1") !== "0";
      const watchDiscovery = String(env.WATCH_DISCOVERY_ENABLED ?? "1") !== "0";
      return json({
        ok: true,
        service: SOURCE,
        last_poll: lastPoll || null,
        liq_drop: liqDrop,
        buyer_stall: buyerStall,
        ghost_scrub: ghostScrub,
        rip_enabled: ripEnabled,
        watch_discovery: watchDiscovery,
        rip_bench_max_size: Math.max(1, Math.floor(num(env.RIP_BENCH_MAX_SIZE, 25))),
      });
    }

    if (request.method === "POST" && path === "/run") {
      const auth = request.headers.get("Authorization") || "";
      const expected = env.WEBHOOK_SECRET;
      if (!expected || auth !== `Bearer ${expected}`) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const result = await pollOnce(env);
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(pollOnce(env));
  },
};

async function pollOnce(env) {
  const fillsUrl = env.FILLS_URL;
  const started = new Date().toISOString();
  let alerts = 0;
  let checked = 0;
  let errors = [];

  let fills;
  try {
    const bust = fillsUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${fillsUrl}${bust}t=${Date.now()}`, {
      headers: { Accept: "application/json", "User-Agent": SOURCE, "Cache-Control": "no-cache" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) throw new Error(`fills HTTP ${res.status}`);
    fills = await res.json();
  } catch (e) {
    const msg = `fills fetch failed: ${e.message || e}`;
    console.error(msg);
    await env.DESK_STATE.put("last_poll", started);
    return { last_poll: started, checked: 0, alerts: 0, error: msg };
  }

  const positions = Array.isArray(fills?.positions) ? fills.positions : [];
  const thresholds = {
    liqDrop: num(env.LIQ_DROP_PCT, 0.3),
    trailEnabled: String(env.TRAIL_ENABLED ?? "1") !== "0",
    trailArm: num(env.TRAIL_ARM_PCT, 0.2),
    trailExit: num(env.TRAIL_EXIT_PCT, 0.05),
    fastDump: num(env.FAST_DUMP_PCT, 0.15),
    hardMinus: num(env.HARD_MINUS_PCT, 0.15),
    // SAVE_POINTS=1: ratchet floors +20→+10, +50→+25, +100→+50, +200→+100
    savePoints: String(env.SAVE_POINTS ?? "0") !== "0",
    dedupeSec: Math.max(1, Math.floor(num(env.DEDUPE_SECONDS, 180))),
    ripEnabled: String(env.RIP_ENABLED ?? "0") === "1",
    ripPlus20: num(env.RIP_PLUS20_PCT, 0.2),
    ripPlus50Enabled: String(env.RIP_PLUS50_ENABLED ?? "0") === "1",
    ripPlus50: 0.5,
    buyerStallEnabled: String(env.BUYER_STALL_ENABLED ?? "1") !== "0",
    buyerStallRatio: num(env.BUYER_STALL_RATIO, 0.2),
    buyerStallMinPeak: num(env.BUYER_STALL_MIN_PEAK, 50),
    ghostScrub: String(env.GHOST_SCRUB ?? "1") !== "0",
  };

  const openMints = new Set(
    positions
      .map((p) => (p?.mint || "").toLowerCase())
      .filter(Boolean)
  );

  for (const pos of positions) {
    const mint = pos?.mint;
    if (!mint || typeof mint !== "string") continue;
    checked += 1;
    try {
      const n = await evaluatePosition(env, pos, fillsUrl, thresholds);
      alerts += n;
    } catch (e) {
      const msg = `${mint}: ${e.message || e}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  if (thresholds.ghostScrub) {
    try {
      await ghostScrubClosed(env, openMints);
    } catch (e) {
      const msg = `GHOST_SCRUB: ${e.message || e}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  if (thresholds.ripEnabled && String(env.RIP_BENCH_ENABLED ?? "1") !== "0") {
    try {
      const n = await evaluateRipBench(env, fillsUrl, openMints, thresholds);
      alerts += n;
    } catch (e) {
      const msg = `RIP_BENCH: ${e.message || e}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  if (String(env.WATCH_DISCOVERY_ENABLED ?? "1") !== "0") {
    try {
      const n = await evaluateWatchDiscovery(env, fillsUrl, openMints, thresholds);
      alerts += n;
    } catch (e) {
      const msg = `WATCH_NEW: ${e.message || e}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  await env.DESK_STATE.put("last_poll", started);
  const out = { last_poll: started, checked, alerts };
  if (errors.length) out.errors = errors;
  return out;
}

async function evaluatePosition(env, pos, fillsUrl, thBase) {
  const mint = pos.mint;
  const ticker = pos.ticker || pos.name || mint.slice(0, 8);
  const fillUsd = num(pos.fill_usd, NaN);
  const fillPrice = num(pos.fill_price_usd, NaN);

  // Per-position overrides from fills.json (mechanism tests, mixed book)
  const rules = Array.isArray(pos.exit_rules)
    ? pos.exit_rules.map((r) => String(r).toUpperCase())
    : [];
  const trailField = String(pos.trail || "").toUpperCase();
  const flagBag = new Set((pos.flags || []).map(String));
  const th = { ...thBase };
  const hardFromRules = rules
    .map((r) => {
      const m = /^HARD_MINUS(\d+)$/.exec(r);
      return m ? Number(m[1]) / 100 : null;
    })
    .find((n) => n != null);
  if (hardFromRules != null && Number.isFinite(hardFromRules)) {
    th.hardMinus = hardFromRules;
  }
  // Parse "+20→+10" / "+20->+10" into arm/exit overrides
  const trailParse = /\+?(\d+)\s*(?:→|->|TO)\s*\+?(\d+)/i.exec(
    String(pos.trail || "")
  );
  if (trailParse) {
    th.trailArm = Number(trailParse[1]) / 100;
    th.trailExit = Number(trailParse[2]) / 100;
  }
  const trailExplicitOn =
    flagBag.has("TRAIL_ARMED") ||
    Boolean(trailParse) ||
    (trailField.includes("+") && trailField !== "OFF");
  const trailOff =
    !trailExplicitOn &&
    (trailField === "OFF" ||
      trailField === "0" ||
      trailField === "FALSE" ||
      (rules.length > 0 && !rules.includes("TRAIL_GIVEBACK")));
  if (trailOff) th.trailEnabled = false;
  if