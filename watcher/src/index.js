/**
 * coins-desk-watcher — alert-only Cloudflare Worker
 * Polls fills.json + DexScreener, trips rules, POSTs webhook alerts.
 * No auto-sell. Secrets via wrangler secret only (never in this file).
 */

const SCHEMA = "coins-desk-alert/v1";
const SOURCE = "coins-desk-watcher";
const DEX_TOKEN_URL = "https://api.dexscreener.com/latest/dex/tokens/";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && (path === "/" || path === "/health")) {
      const lastPoll = await env.DESK_STATE.get("last_poll");
      return json({
        ok: true,
        service: SOURCE,
        last_poll: lastPoll || null,
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
    liqDrop: num(env.LIQ_DROP_PCT, 0.25),
    trailEnabled: String(env.TRAIL_ENABLED ?? "1") !== "0",
    trailArm: num(env.TRAIL_ARM_PCT, 0.2),
    trailExit: num(env.TRAIL_EXIT_PCT, 0.05),
    fastDump: num(env.FAST_DUMP_PCT, 0.15),
    hardMinus: num(env.HARD_MINUS_PCT, 0.15),
    // SAVE_POINTS=1 enables stepped floors: +50→+25, +100→+50, +200→+100
    savePoints: String(env.SAVE_POINTS ?? "0") !== "0",
    dedupeSec: Math.max(1, Math.floor(num(env.DEDUPE_SECONDS, 180))),
  };

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
  const trailOff =
    trailField === "OFF" ||
    trailField === "0" ||
    trailField === "FALSE" ||
    (rules.length > 0 && !rules.includes("TRAIL_GIVEBACK"));
  if (trailOff) th.trailEnabled = false;
  // Mechanism-only: exit_rules is just HARD_MINUS* → skip liq/fast/save noise
  const hardOnly =
    rules.length > 0 && rules.every((r) => /^HARD_MINUS\d+$/.test(r));
  if (hardOnly) {
    th.liqDrop = 99; // effectively disable
    th.fastDump = 99;
    th.savePoints = false;
    th.trailEnabled = false;
  }

  const pair = await bestSolanaPair(mint);
  if (!pair) {
    console.log(`no solana pair for ${ticker} ${mint}`);
    return 0;
  }

  const tokenAmount =
    pos.tokens ?? pos.fill_token_amount ?? pos.token_amount ?? pos.amount;
  const markUsd = pickMarkUsd(pair, fillPrice, fillUsd, tokenAmount);
  const liqUsd = num(pair.liquidity?.usd, 0);
  const dexUrl =
    pair.url || `https://dexscreener.com/solana/${pair.pairAddress || mint}`;
  const priceUsd = num(pair.priceUsd, NaN);

  const markKey = `mark:${mint}`;
  const prevRaw = await env.DESK_STATE.get(markKey);
  let prev = null;
  if (prevRaw) {
    try {
      prev = JSON.parse(prevRaw);
    } catch (_) {
      prev = null;
    }
  }

  const trailKey = `trail_armed:${mint}`;
  let trailArmed = (await env.DESK_STATE.get(trailKey)) === "1";

  const vsFillPct =
    Number.isFinite(fillUsd) && fillUsd > 0 && Number.isFinite(markUsd)
      ? (markUsd - fillUsd) / fillUsd
      : Number.isFinite(fillPrice) && fillPrice > 0 && Number.isFinite(priceUsd)
        ? (priceUsd - fillPrice) / fillPrice
        : null;

  // Arm trailing once +trailArm vs fill (skipped when TRAIL_ENABLED=0)
  if (
    th.trailEnabled &&
    !trailArmed &&
    vsFillPct != null &&
    vsFillPct >= th.trailArm
  ) {
    trailArmed = true;
    await env.DESK_STATE.put(trailKey, "1");
  }

  const liqPrev = prev && Number.isFinite(prev.liq_usd) ? prev.liq_usd : null;
  const pricePrev =
    prev && Number.isFinite(prev.price_usd) ? prev.price_usd : null;

  const trips = [];

  // LIQ_DROP: liq -25% vs prev
  if (liqPrev != null && liqPrev > 0 && liqUsd > 0) {
    const liqChange = (liqUsd - liqPrev) / liqPrev;
    if (liqChange <= -th.liqDrop) {
      trips.push({
        rule: "LIQ_DROP",
        note: `liquidity dropped ${(liqChange * 100).toFixed(1)}% vs prior mark`,
        liq_change_pct: round4(liqChange * 100),
      });
    }
  }

  // TRAIL_GIVEBACK: armed and now <= trailExit vs fill
  if (
    th.trailEnabled &&
    trailArmed &&
    vsFillPct != null &&
    vsFillPct <= th.trailExit
  ) {
    trips.push({
      rule: "TRAIL_GIVEBACK",
      note: `trail armed at +${(th.trailArm * 100).toFixed(0)}%; now ${(vsFillPct * 100).toFixed(1)}% vs fill`,
      liq_change_pct: null,
    });
  }

  // SAVE_POINT floors: arm on rise, cut if giveback through floor
  if (th.savePoints && vsFillPct != null) {
    const floorKey = `save_floor:${mint}`;
    let floor = null;
    const floorRaw = await env.DESK_STATE.get(floorKey);
    if (floorRaw != null && floorRaw !== "") {
      const f = Number(floorRaw);
      if (Number.isFinite(f)) floor = f;
    }
    const rungs = [
      { arm: 0.5, floor: 0.25 },
      { arm: 1.0, floor: 0.5 },
      { arm: 2.0, floor: 1.0 },
    ];
    let nextFloor = floor;
    for (const r of rungs) {
      if (vsFillPct >= r.arm) {
        nextFloor = nextFloor == null ? r.floor : Math.max(nextFloor, r.floor);
      }
    }
    if (nextFloor != null && nextFloor !== floor) {
      floor = nextFloor;
      await env.DESK_STATE.put(floorKey, String(floor));
    }
    if (floor != null && vsFillPct <= floor) {
      trips.push({
        rule: "SAVE_POINT",
        note: `save floor +${(floor * 100).toFixed(0)}%; now ${(vsFillPct * 100).toFixed(1)}% vs fill`,
        liq_change_pct: null,
      });
    }
  }

  // FAST_DUMP: price -15% vs prev
  if (pricePrev != null && pricePrev > 0 && Number.isFinite(priceUsd)) {
    const priceChange = (priceUsd - pricePrev) / pricePrev;
    if (priceChange <= -th.fastDump) {
      trips.push({
        rule: "FAST_DUMP",
        note: `price dropped ${(priceChange * 100).toFixed(1)}% vs prior mark`,
        liq_change_pct: null,
      });
    }
  }

  // HARD_MINUS*: vs fill <= -hardMinus (overnight default -15%)
  if (vsFillPct != null && vsFillPct <= -th.hardMinus) {
    const hardLabel = `HARD_MINUS${Math.round(th.hardMinus * 100)}`;
    trips.push({
      rule: hardLabel,
      note: `mark ${(vsFillPct * 100).toFixed(1)}% vs fill`,
      liq_change_pct: null,
    });
  }


  // Persist latest mark after evaluating (so first poll arms baseline)
  await env.DESK_STATE.put(
    markKey,
    JSON.stringify({
      ts: new Date().toISOString(),
      mark_usd: markUsd,
      price_usd: Number.isFinite(priceUsd) ? priceUsd : null,
      liq_usd: liqUsd,
      pair: pair.pairAddress || null,
    })
  );

  let sent = 0;
  for (const trip of trips) {
    const ok = await maybeSendAlert(env, {
      rule: trip.rule,
      ticker,
      mint,
      fill_usd: Number.isFinite(fillUsd) ? round4(fillUsd) : null,
      mark_usd: Number.isFinite(markUsd) ? round4(markUsd) : null,
      vs_fill_pct: vsFillPct != null ? round4(vsFillPct * 100) : null,
      liq_usd: round4(liqUsd),
      liq_prev_usd: liqPrev != null ? round4(liqPrev) : null,
      liq_change_pct:
        trip.liq_change_pct != null
          ? trip.liq_change_pct
          : liqPrev != null && liqPrev > 0
            ? round4(((liqUsd - liqPrev) / liqPrev) * 100)
            : null,
      price_prev_usd: pricePrev != null ? round4(pricePrev) : null,
      note: trip.note,
      fills_url: fillsUrl,
      dex_url: dexUrl,
      dedupeSec: th.dedupeSec,
    });
    if (ok) sent += 1;
  }
  return sent;
}

async function bestSolanaPair(mint) {
  const res = await fetch(`${DEX_TOKEN_URL}${encodeURIComponent(mint)}`, {
    headers: { Accept: "application/json", "User-Agent": SOURCE },
  });
  if (!res.ok) throw new Error(`dexscreener HTTP ${res.status}`);
  const data = await res.json();
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const want = (mint || "").toLowerCase();
  // Prefer pairs where our mint is the BASE token (avoid inverted quote pairs).
  const sol = pairs.filter((p) => {
    if ((p.chainId || "").toLowerCase() !== "solana") return false;
    if (!want) return true;
    const base = (p.baseToken?.address || "").toLowerCase();
    return base === want;
  });
  if (!sol.length) return null;
  sol.sort(
    (a, b) => num(b.liquidity?.usd, 0) - num(a.liquidity?.usd, 0)
  );
  return sol[0];
}

function pickMarkUsd(pair, fillPrice, fillUsd, tokenAmount) {
  const priceUsd = num(pair.priceUsd, NaN);
  const tokens = num(tokenAmount, NaN);
  // Clip mark = tokens × px (never bare token price — that falsely trips HARD_MINUS)
  if (Number.isFinite(priceUsd) && Number.isFinite(tokens) && tokens > 0) {
    return priceUsd * tokens;
  }
  if (
    Number.isFinite(priceUsd) &&
    Number.isFinite(fillPrice) &&
    fillPrice > 0 &&
    Number.isFinite(fillUsd) &&
    fillUsd > 0
  ) {
    return fillUsd * (priceUsd / fillPrice);
  }
  // Last resort: if we only know fillUsd, hold prior clip notionals — do NOT
  // return raw priceUsd (unit mismatch vs fill_usd).
  if (Number.isFinite(fillUsd) && fillUsd > 0) return fillUsd;
  return NaN;
}

async function maybeSendAlert(env, payload) {
  const dedupeKey = `alert:${payload.mint}:${payload.rule}`;
  const existing = await env.DESK_STATE.get(dedupeKey);
  if (existing) {
    console.log(`dedupe skip ${dedupeKey}`);
    return false;
  }

  const body = {
    schema: SCHEMA,
    ts: new Date().toISOString(),
    source: SOURCE,
    rule: payload.rule,
    ticker: payload.ticker,
    mint: payload.mint,
    fill_usd: payload.fill_usd,
    mark_usd: payload.mark_usd,
    vs_fill_pct: payload.vs_fill_pct,
    liq_usd: payload.liq_usd,
    liq_prev_usd: payload.liq_prev_usd,
    liq_change_pct: payload.liq_change_pct,
    price_prev_usd: payload.price_prev_usd,
    note: payload.note,
    fills_url: payload.fills_url,
    dex_url: payload.dex_url,
  };

  const webhookUrl = env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("dry-run alert (WEBHOOK_URL missing):", JSON.stringify(body));
    // Do not count as sent; do not set dedupe so a later configured webhook can fire
    return false;
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": SOURCE,
  };
  if (env.WEBHOOK_SECRET) {
    headers["Authorization"] = `Bearer ${env.WEBHOOK_SECRET}`;
    headers["X-Desk-Secret"] = env.WEBHOOK_SECRET;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
    return false;
  }

  await env.DESK_STATE.put(dedupeKey, body.ts, {
    expirationTtl: payload.dedupeSec,
  });
  return true;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function num(v, fallback) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
