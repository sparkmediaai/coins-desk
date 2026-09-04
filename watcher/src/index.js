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
  if (trailExplicitOn) th.trailEnabled = true;
  // Mechanism-only: exit_rules is just HARD_MINUS* → skip liq/fast/save noise
  // Keep trail if explicitly armed on the blotter.
  const hardOnly =
    rules.length > 0 && rules.every((r) => /^HARD_MINUS\d+$/.test(r));
  if (hardOnly) {
    th.liqDrop = 99; // effectively disable
    th.fastDump = 99;
    if (!trailExplicitOn) {
      th.savePoints = false;
      th.trailEnabled = false;
    }
    th.buyerStallEnabled = false;
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
    // Seed first save-point floor (+20 → +10)
    if (th.savePoints) {
      const floorKey = `save_floor:${mint}`;
      const cur = Number(await env.DESK_STATE.get(floorKey));
      const seed = th.trailExit; // 0.10
      if (!Number.isFinite(cur) || cur < seed) {
        await env.DESK_STATE.put(floorKey, String(seed));
      }
    }
  }
  // Blotter already TRAIL_ARMED → ensure KV trail + first floor
  if (
    th.trailEnabled &&
    th.savePoints &&
    (trailArmed ||
      new Set((pos.flags || []).map(String)).has("TRAIL_ARMED") ||
      String(pos.trail || "").includes("+20"))
  ) {
    if (!trailArmed) {
      trailArmed = true;
      await env.DESK_STATE.put(trailKey, "1");
    }
    const floorKey = `save_floor:${mint}`;
    const cur = Number(await env.DESK_STATE.get(floorKey));
    const seed = th.trailExit;
    if (!Number.isFinite(cur) || cur < seed) {
      await env.DESK_STATE.put(floorKey, String(seed));
    }
  }

  const liqPrev = prev && Number.isFinite(prev.liq_usd) ? prev.liq_usd : null;
  const pricePrev =
    prev && Number.isFinite(prev.price_usd) ? prev.price_usd : null;

  const trips = [];

  // LIQ_DROP: open-only; liq down >= LIQ_DROP_PCT vs last stored liq (alert-only)
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

  // UNIQUE_BUYER_STALL: open-only; peak h1 buys then stall (<= ratio of peak or dead)
  if (th.buyerStallEnabled) {
    const buysNow = num(pair.txns?.h1?.buys, NaN);
    const peakKey = `buyer_peak:${mint}`;
    let peakBuys = null;
    const peakRaw = await env.DESK_STATE.get(peakKey);
    if (peakRaw != null && peakRaw !== "") {
      const p = Number(peakRaw);
      if (Number.isFinite(p)) peakBuys = p;
    }
    if (Number.isFinite(buysNow)) {
      if (peakBuys == null || buysNow > peakBuys) {
        peakBuys = buysNow;
        await env.DESK_STATE.put(peakKey, String(peakBuys));
      }
    }
    const dead = !Number.isFinite(buysNow) || buysNow <= 0;
    const stalled =
      peakBuys != null &&
      peakBuys >= th.buyerStallMinPeak &&
      (dead || (Number.isFinite(buysNow) && buysNow <= peakBuys * th.buyerStallRatio));
    if (stalled) {
      const cur = dead ? 0 : buysNow;
      trips.push({
        rule: "UNIQUE_BUYER_STALL",
        note: `h1 buys ${cur} vs peak ${peakBuys} (<= ${(th.buyerStallRatio * 100).toFixed(0)}% of peak or dead)`,
        liq_change_pct: null,
      });
    }
  }

  // SAVE_POINT ladder (ratchet up only): +20→+10, +50→+25, +100→+50, +200→+100
  let saveFloor = null;
  if (th.savePoints && vsFillPct != null) {
    const floorKey = `save_floor:${mint}`;
    const floorRaw = await env.DESK_STATE.get(floorKey);
    if (floorRaw != null && floorRaw !== "") {
      const f = Number(floorRaw);
      if (Number.isFinite(f)) saveFloor = f;
    }
    const rungs = [
      { arm: 0.2, floor: 0.1 },
      { arm: 0.5, floor: 0.25 },
      { arm: 1.0, floor: 0.5 },
      { arm: 2.0, floor: 1.0 },
    ];
    let nextFloor = saveFloor;
    for (const r of rungs) {
      if (vsFillPct >= r.arm) {
        nextFloor = nextFloor == null ? r.floor : Math.max(nextFloor, r.floor);
      }
    }
    if (nextFloor != null && nextFloor !== saveFloor) {
      saveFloor = nextFloor;
      await env.DESK_STATE.put(floorKey, String(saveFloor));
      trips.push({
        rule: "SAVE_POINT_ARM",
        note: `save floor raised to +${(saveFloor * 100).toFixed(0)}% (mark +${(vsFillPct * 100).toFixed(1)}%)`,
        liq_change_pct: null,
      });
    }
  }

  // TRAIL_GIVEBACK / SAVE_POINT cut: use ratcheted floor when save-points on
  const trailFloor =
    th.savePoints && saveFloor != null ? saveFloor : th.trailExit;
  if (
    th.trailEnabled &&
    trailArmed &&
    vsFillPct != null &&
    vsFillPct <= trailFloor
  ) {
    trips.push({
      rule: th.savePoints ? "SAVE_POINT" : "TRAIL_GIVEBACK",
      note: `trail floor +${(trailFloor * 100).toFixed(0)}%; now ${(vsFillPct * 100).toFixed(1)}% vs fill — return to RIP_BENCH (not a ban)`,
      liq_change_pct: null,
      return_to_rip_bench: true,
    });
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
      note: `mark ${(vsFillPct * 100).toFixed(1)}% vs fill — return to RIP_BENCH (not a ban)`,
      liq_change_pct: null,
      return_to_rip_bench: true,
    });
  }

  // RIP_PLUS20 / RIP_PLUS50: sticky hysteresis — alert once when reclaiming
  // above threshold; stay silent while still above; clear arm when under so
  // a later reclaim can re-alert (stops 180s TTL echo spam).
  if (th.ripEnabled && vsFillPct != null) {
    const flagBag = new Set((pos.flags || []).map(String));
    const ripRules = [
      {
        rule: "RIP_PLUS20",
        thr: th.ripPlus20,
        note: `mark +${(vsFillPct * 100).toFixed(1)}% vs fill (>= +${(th.ripPlus20 * 100).toFixed(0)}%)`,
        pretreat:
          flagBag.has("RIP_PLUS20") ||
          flagBag.has("TRAIL_ARMED") ||
          String(pos.trail || "").includes("+20"),
      },
    ];
    if (th.ripPlus50Enabled) {
      ripRules.push({
        rule: "RIP_PLUS50",
        thr: th.ripPlus50,
        note: `mark +${(vsFillPct * 100).toFixed(1)}% vs fill (>= +50%)`,
        pretreat: flagBag.has("RIP_PLUS50"),
      });
    }
    for (const rr of ripRules) {
      const armKey = `rip_arm:${mint}:${rr.rule}`;
      if (vsFillPct >= rr.thr) {
        const armed = await env.DESK_STATE.get(armKey);
        if (armed || rr.pretreat) {
          // Already armed (KV or fills blotter) — keep sticky, no echo
          if (!armed) {
            await env.DESK_STATE.put(armKey, new Date().toISOString());
          }
        } else {
          trips.push({
            rule: rr.rule,
            note: rr.note,
            liq_change_pct: null,
            armKey,
          });
        }
      } else {
        // Dropped under threshold — clear so a reclaim can fire once
        await env.DESK_STATE.delete(armKey);
      }
    }
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
      // RIP sticky arm: skip short TTL so reclaim logic owns re-alerts
      stickyArm: Boolean(trip.armKey),
      return_to_rip_bench: Boolean(trip.return_to_rip_bench),
    });
    if (ok) {
      sent += 1;
      if (trip.armKey) {
        await env.DESK_STATE.put(trip.armKey, new Date().toISOString());
      }
    }
  }
  return sent;
}

/**
 * RIP_BENCH — scan Solana candidates off the open book via DexScreener
 * public endpoints (boosts + latest profiles → token pairs).
 * Dex priceChange.m5/h1 are percent numbers (8.5 === 8.5%).
 */
async function evaluateRipBench(env, fillsUrl, openMints, th) {
  const m5Min = num(env.RIP_BENCH_M5_PCT, 8); // Dex % units
  const h1Min = num(env.RIP_BENCH_H1_PCT, 25);
  const minLiq = num(env.RIP_BENCH_MIN_LIQ, 150000);
  const minAgeH = num(env.RIP_BENCH_MIN_AGE_H, 12);
  const maxBuys1h = num(env.RIP_BENCH_MAX_BUYS_1H, 2000);
  const maxAlerts = Math.max(1, Math.floor(num(env.RIP_BENCH_MAX_ALERTS, 3)));
  const dedupeSec = th.dedupeSec;
  const now = Date.now();
  const minCreated = now - minAgeH * 3600 * 1000;

  const maxSize = Math.max(1, Math.floor(num(env.RIP_BENCH_MAX_SIZE, 25)));
  const buyTilt = num(env.RIP_BENCH_BUY_TILT, 1.15);
  const liqDropGate = num(env.RIP_BENCH_LIQ_DROP_PCT, 0.35);
  // Curated bench only (fills.rip_bench / hunt / closed) — not a Dex spray
  const candidateMints = await collectCuratedBenchMints(fillsUrl, openMints, maxSize);
  if (!candidateMints.length) {
    console.log("rip_bench: no curated candidates");
    return 0;
  }

  // Batch tokens endpoint (Dex accepts comma-separated, keep batches modest)
  const pairsByMint = new Map();
  const batchSize = 25;
  for (let i = 0; i < candidateMints.length; i += batchSize) {
    const batch = candidateMints.slice(i, i + batchSize);
    try {
      const res = await fetch(
        `${DEX_TOKEN_URL}${batch.map(encodeURIComponent).join(",")}`,
        { headers: { Accept: "application/json", "User-Agent": SOURCE } }
      );
      if (!res.ok) {
        console.error(`rip bench tokens HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      for (const p of pairs) {
        if ((p.chainId || "").toLowerCase() !== "solana") continue;
        const base = (p.baseToken?.address || "").toLowerCase();
        if (!base) continue;
        const prev = pairsByMint.get(base);
        if (!prev || num(p.liquidity?.usd, 0) > num(prev.liquidity?.usd, 0)) {
          pairsByMint.set(base, p);
        }
      }
    } catch (e) {
      console.error(`rip bench batch fetch: ${e.message || e}`);
    }
  }

  const hits = [];
  for (const [mintLc, pair] of pairsByMint) {
    if (openMints.has(mintLc)) continue;
    const quote = (pair.quoteToken?.address || "").toLowerCase();
    if (!QUOTE_OK.has(quote)) continue;
    const base = (pair.baseToken?.address || "").toLowerCase();
    if (base !== mintLc) continue;

    const liq = num(pair.liquidity?.usd, 0);
    if (liq < minLiq) continue;

    const created = num(pair.pairCreatedAt, 0);
    if (!created || created > minCreated) continue; // need age >= minAgeH

    const buys1h = num(pair.txns?.h1?.buys, NaN);
    const sells1h = num(pair.txns?.h1?.sells, NaN);
    if (Number.isFinite(buys1h) && buys1h > maxBuys1h) continue;
    // Buy-tilt: skip sell-heavy fake rips (if sells known)
    if (
      Number.isFinite(buys1h) &&
      Number.isFinite(sells1h) &&
      sells1h > 0 &&
      buyTilt > 0 &&
      buys1h < sells1h * buyTilt
    ) {
      continue;
    }

    // Liq not collapsing vs recent peak (fake rip into exit liquidity)
    const peakKey = `rip_liq_peak:${mintLc}`;
    const peakPrev = num(await env.DESK_STATE.get(peakKey), 0);
    if (liq > peakPrev) {
      await env.DESK_STATE.put(peakKey, String(liq), { expirationTtl: 60 * 60 * 24 });
    }
    const peak = Math.max(peakPrev, liq);
    if (peak > 0 && liqDropGate > 0 && liq < peak * (1 - liqDropGate)) {
      continue;
    }

    // Dex returns percent units (8.5 = +8.5%)
    const m5 = num(pair.priceChange?.m5, NaN);
    const h1 = num(pair.priceChange?.h1, NaN);
    const m5Ok = Number.isFinite(m5) && m5 >= m5Min;
    const h1Ok = Number.isFinite(h1) && h1 >= h1Min;
    const qualifies = m5Ok || h1Ok;
    // Cool only well under both floors (half threshold) — stops flicker
    // reclaim spam when m5/h1 hover near the trip lines.
    const cool =
      (!Number.isFinite(m5) || m5 < m5Min * 0.5) &&
      (!Number.isFinite(h1) || h1 < h1Min * 0.5);

    const mint = pair.baseToken.address;
    const armKey = `rip_arm:${mintLc}:RIP_BENCH`;
    const armTtl = 60 * 60 * 12; // 12h belt; cool-clear still owns reclaim

    if (cool) {
      await env.DESK_STATE.delete(armKey);
      // also drop short alert key so migrate can't resurrect a ghost
      await env.DESK_STATE.delete(`alert:${mint}:RIP_BENCH`);
      continue;
    }

    if (!qualifies) {
      // Warm band (between cool and trip): keep any existing arm, no new alert
      continue;
    }

    let armed = await env.DESK_STATE.get(armKey);
    if (!armed) {
      // Migrate short-TTL alert key → sticky arm (kills mid-spam echoes)
      const alertExisting = await env.DESK_STATE.get(
        `alert:${mint}:RIP_BENCH`
      );
      if (alertExisting) {
        await env.DESK_STATE.put(armKey, alertExisting, {
          expirationTtl: armTtl,
        });
        armed = alertExisting;
      }
    }
    if (armed) {
      console.log(`rip_bench sticky skip ${mintLc}`);
      continue;
    }

    const ticker =
      pair.baseToken?.symbol ||
      pair.baseToken?.name ||
      mintLc.slice(0, 8);
    const priceUsd = num(pair.priceUsd, NaN);
    hits.push({
      mint,
      mintLc,
      armKey,
      ticker,
      priceUsd,
      liq,
      buys1h: Number.isFinite(buys1h) ? buys1h : null,
      sells1h: Number.isFinite(sells1h) ? sells1h : null,
      m5: Number.isFinite(m5) ? m5 : null,
      h1: Number.isFinite(h1) ? h1 : null,
      dexUrl:
        pair.url ||
        `https://dexscreener.com/solana/${pair.pairAddress || pair.baseToken.address}`,
    });
  }

  hits.sort((a, b) => {
    const am = a.m5 == null ? -Infinity : a.m5;
    const bm = b.m5 == null ? -Infinity : b.m5;
    if (bm !== am) return bm - am;
    const ah = a.h1 == null ? -Infinity : a.h1;
    const bh = b.h1 == null ? -Infinity : b.h1;
    return bh - ah;
  });

  let sent = 0;
  for (const hit of hits.slice(0, maxAlerts)) {
    const m5s = hit.m5 == null ? "?" : hit.m5.toFixed(1);
    const h1s = hit.h1 == null ? "?" : hit.h1.toFixed(1);
    const bs =
      hit.buys1h == null && hit.sells1h == null
        ? "?"
        : `${hit.buys1h ?? "—"}/${hit.sells1h ?? "—"}`;
    const hygiene = await mintHygiene(hit.mint, env);
    const hyNote = hygieneNote(hygiene);
    const ok = await maybeSendAlert(env, {
      rule: "RIP_BENCH",
      ticker: hit.ticker,
      mint: hit.mint,
      fill_usd: null,
      mark_usd: null,
      vs_fill_pct: null,
      liq_usd: round4(hit.liq),
      liq_prev_usd: null,
      liq_change_pct: null,
      price_prev_usd: null,
      price_usd: Number.isFinite(hit.priceUsd) ? round4(hit.priceUsd) : null,
      m5: hit.m5 != null ? round4(hit.m5) : null,
      h1: hit.h1 != null ? round4(hit.h1) : null,
      buys_1h: hit.buys1h,
      sells_1h: hit.sells1h,
      hygiene,
      note: `bench rip m5=${m5s}% h1=${h1s}% liq=$${Math.round(hit.liq)} b/s=${bs}${hyNote}`,
      fills_url: fillsUrl,
      dex_url: hit.dexUrl,
      dedupeSec,
      stickyArm: true,
    });
    if (ok) {
      sent += 1;
      await env.DESK_STATE.put(hit.armKey, new Date().toISOString(), {
        expirationTtl: 60 * 60 * 12,
      });
    }
  }
  return sent;
}

async function collectCuratedBenchMints(fillsUrl, openMints, maxSize = 25) {
  // Prefer explicit fills.rip_bench; else union of hunt + closed mints.
  // Cap size (hot names first in fills.rip_bench order).
  const cap = Math.max(1, Math.floor(maxSize || 25));
  try {
    const res = await fetch(fillsUrl, {
      headers: { Accept: "application/json", "User-Agent": SOURCE },
    });
    if (!res.ok) throw new Error(`fills HTTP ${res.status}`);
    const data = await res.json();
    const out = [];
    const seen = new Set();
    const pushMint = (mint) => {
      if (!mint || typeof mint !== "string") return;
      const lc = mint.toLowerCase();
      if (seen.has(lc) || openMints.has(lc)) return;
      seen.add(lc);
      out.push(mint);
    };
    const curated = Array.isArray(data?.rip_bench) ? data.rip_bench : [];
    if (curated.length) {
      for (const row of curated) {
        pushMint(row?.mint || row);
        if (out.length >= cap) break;
      }
      return out;
    }
    for (const row of [...(data?.hunt || []), ...(data?.closed || [])]) {
      pushMint(row?.mint);
      if (out.length >= cap) break;
    }
    return out;
  } catch (e) {
    console.error(`rip_bench curated load: ${e.message || e}`);
    return [];
  }
}

async function loadCuratedMintSet(fillsUrl) {
  const set = new Set();
  try {
    const res = await fetch(fillsUrl, {
      headers: { Accept: "application/json", "User-Agent": SOURCE },
    });
    if (!res.ok) return set;
    const data = await res.json();
    for (const row of data?.rip_bench || []) {
      const m = (row?.mint || row || "").toLowerCase();
      if (m) set.add(m);
    }
  } catch (e) {
    console.error(`curated set load: ${e.message || e}`);
  }
  return set;
}


/**
 * WATCH_NEW — Dex boosts/profiles discovery. LOOK ONLY — never auto-clip.
 */
async function evaluateWatchDiscovery(env, fillsUrl, openMints, th) {
  const minLiq = num(env.WATCH_MIN_LIQ, 80000);
  const minAgeH = num(env.WATCH_MIN_AGE_H, 0.25);
  const maxAgeH = num(env.WATCH_MAX_AGE_H, 72);
  const maxBuys1h = num(env.WATCH_MAX_BUYS_1H, 2500);
  const maxAlerts = Math.max(1, Math.floor(num(env.WATCH_MAX_ALERTS, 2)));
  const dedupeSec = Math.max(th.dedupeSec, 6 * 3600);
  const now = Date.now();
  const minCreated = now - maxAgeH * 3600 * 1000; // not older than maxAge
  const maxCreated = now - minAgeH * 3600 * 1000; // not younger than minAge

  const curated = await loadCuratedMintSet(fillsUrl);
  const candidates = await collectSolanaCandidateMints();
  const filtered = candidates.filter((m) => {
    const lc = m.toLowerCase();
    return !openMints.has(lc) && !curated.has(lc);
  });
  if (!filtered.length) {
    console.log("watch_new: no candidates");
    return 0;
  }

  const hits = [];
  // Cap RPC/Dex fan-out
  for (const mint of filtered.slice(0, 40)) {
    try {
      const pair = await bestSolanaPair(mint);
      if (!pair) continue;
      const quote = (pair.quoteToken?.address || "").toLowerCase();
      if (!QUOTE_OK.has(quote)) continue;
      const liq = num(pair.liquidity?.usd, 0);
      if (!pair.pairAddress || liq < minLiq) continue;
      const created = num(pair.pairCreatedAt, 0);
      if (!created || created < minCreated || created > maxCreated) continue;
      const buys1h = num(pair.txns?.h1?.buys, NaN);
      const sells1h = num(pair.txns?.h1?.sells, NaN);
      if (Number.isFinite(buys1h) && buys1h > maxBuys1h) continue;
      const m5 = num(pair.priceChange?.m5, NaN);
      const h1 = num(pair.priceChange?.h1, NaN);
      // Need some tape — at least one positive window
      const hot =
        (Number.isFinite(m5) && m5 >= 5) || (Number.isFinite(h1) && h1 >= 15);
      if (!hot) continue;
      const mintLc = mint.toLowerCase();
      const armKey = `rip_arm:${mintLc}:WATCH_NEW`;
      if (await env.DESK_STATE.get(armKey)) continue;
      if (await env.DESK_STATE.get(`alert:${mint}:WATCH_NEW`)) continue;
      hits.push({
        mint,
        mintLc,
        armKey,
        ticker:
          pair.baseToken?.symbol ||
          pair.baseToken?.name ||
          mintLc.slice(0, 8),
        priceUsd: num(pair.priceUsd, NaN),
        liq,
        buys1h: Number.isFinite(buys1h) ? buys1h : null,
        sells1h: Number.isFinite(sells1h) ? sells1h : null,
        m5: Number.isFinite(m5) ? m5 : null,
        h1: Number.isFinite(h1) ? h1 : null,
        dexUrl:
          pair.url ||
          `https://dexscreener.com/solana/${pair.pairAddress || mint}`,
      });
    } catch (e) {
      console.error(`watch_new ${mint}: ${e.message || e}`);
    }
  }

  hits.sort((a, b) => (b.m5 ?? -1e9) - (a.m5 ?? -1e9));
  let sent = 0;
  for (const hit of hits.slice(0, maxAlerts)) {
    const hygiene = await mintHygiene(hit.mint, env);
    const hyNote = hygieneNote(hygiene);
    const m5s = hit.m5 == null ? "?" : hit.m5.toFixed(1);
    const h1s = hit.h1 == null ? "?" : hit.h1.toFixed(1);
    const bs =
      hit.buys1h == null && hit.sells1h == null
        ? "?"
        : `${hit.buys1h ?? "—"}/${hit.sells1h ?? "—"}`;
    const ok = await maybeSendAlert(env, {
      rule: "WATCH_NEW",
      ticker: hit.ticker,
      mint: hit.mint,
      fill_usd: null,
      mark_usd: null,
      vs_fill_pct: null,
      liq_usd: round4(hit.liq),
      liq_prev_usd: null,
      liq_change_pct: null,
      price_prev_usd: null,
      price_usd: Number.isFinite(hit.priceUsd) ? round4(hit.priceUsd) : null,
      m5: hit.m5 != null ? round4(hit.m5) : null,
      h1: hit.h1 != null ? round4(hit.h1) : null,
      buys_1h: hit.buys1h,
      sells_1h: hit.sells1h,
      hygiene,
      note: `WATCH only — do not auto-clip · m5=${m5s}% h1=${h1s}% liq=$${Math.round(hit.liq)} b/s=${bs}${hyNote}`,
      fills_url: fillsUrl,
      dex_url: hit.dexUrl,
      dedupeSec,
      stickyArm: true,
    });
    if (ok) {
      sent += 1;
      await env.DESK_STATE.put(hit.armKey, new Date().toISOString(), {
        expirationTtl: 60 * 60 * 6,
      });
    }
  }
  return sent;
}

function hygieneNote(h) {
  if (!h) return "";
  if (h.error) return ` · hygiene=rpc_fail`;
  const parts = [];
  if (h.flags && h.flags.length) parts.push(h.flags.join(","));
  else {
    if (h.mintAuthority) parts.push("MINT_AUTH_LIVE");
    if (h.freezeAuthority) parts.push("FREEZE_AUTH_LIVE");
    if (h.program === "spl-token-2022") parts.push("TOKEN_2022");
    if (h.transferFeePct != null) parts.push(`TRANSFER_FEE_${h.transferFeePct}%`);
  }
  return parts.length ? ` · ${parts.join(",")}` : " · mint+freeze clean";
}

async function mintHygiene(mint, env) {
  const key = `hygiene:${(mint || "").toLowerCase()}`;
  try {
    const cached = await env.DESK_STATE.get(key);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_) {}
    }
  } catch (_) {}

  const rpc = env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const out = {
    program: "unknown",
    mintAuthority: null,
    freezeAuthority: null,
    transferFeePct: null,
    flags: [],
  };
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": SOURCE },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed" }],
      }),
    });
    if (!res.ok) throw new Error(`rpc HTTP ${res.status}`);
    const data = await res.json();
    const value = data?.result?.value;
    if (!value) {
      out.error = "no_account";
      return out;
    }
    const owner = value.owner || "";
    if (owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") {
      out.program = "spl-token-2022";
      out.flags.push("TOKEN_2022");
    } else if (owner === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
      out.program = "spl-token";
    }
    const info = value.data?.parsed?.info || {};
    out.mintAuthority = info.mintAuthority != null;
    out.freezeAuthority = info.freezeAuthority != null;
    if (out.mintAuthority) out.flags.push("MINT_AUTH_LIVE");
    if (out.freezeAuthority) out.flags.push("FREEZE_AUTH_LIVE");
    const exts = Array.isArray(info.extensions) ? info.extensions : [];
    for (const ext of exts) {
      if ((ext.extension || "") === "transferFeeConfig") {
        const bps = num(
          ext.state?.newerTransferFee?.transferFeeBasisPoints ??
            ext.state?.olderTransferFee?.transferFeeBasisPoints,
          NaN
        );
        if (Number.isFinite(bps)) {
          out.transferFeePct = Math.round((bps / 100) * 100) / 100;
          out.flags.push(`TRANSFER_FEE_${out.transferFeePct}%`);
        }
      }
    }
    try {
      await env.DESK_STATE.put(key, JSON.stringify(out), {
        expirationTtl: 60 * 60 * 6,
      });
    } catch (_) {}
    return out;
  } catch (e) {
    console.error(`mintHygiene ${mint}: ${e.message || e}`);
    return { error: "rpc_fail", flags: [], program: "unknown" };
  }
}

async function collectSolanaCandidateMints() {
  const out = new Set();
  const urls = [DEX_BOOSTS_URL, DEX_PROFILES_URL];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": SOURCE },
      });
      if (!res.ok) {
        console.error(`rip candidates ${url} HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      for (const item of list) {
        if ((item.chainId || "").toLowerCase() !== "solana") continue;
        const addr = item.tokenAddress;
        if (addr && typeof addr === "string") out.add(addr);
      }
    } catch (e) {
      console.error(`rip candidates ${url}: ${e.message || e}`);
    }
  }
  return [...out];
}

async function ghostScrubClosed(env, openMints) {
  // Drop DESK_STATE keys for mints no longer in fills.positions.
  // CRITICAL: never scrub RIP_BENCH arms/alerts — those mints are never in
  // openMints, so scrubbing them every poll nukes sticky dedupe.
  const prefixes = ["mark:", "trail_armed:", "save_floor:", "buyer_peak:", "alert:", "rip_arm:"];
  for (const prefix of prefixes) {
    let cursor;
    do {
      const page = await env.DESK_STATE.list({ prefix, cursor, limit: 1000 });
      for (const key of page.keys || []) {
        const name = key.name;
        let mintLc = null;
        let rule = null;
        if (prefix === "alert:" || prefix === "rip_arm:") {
          // alert|rip_arm:{mint}:{rule}
          const rest = name.slice(prefix.length);
          const colon = rest.indexOf(":");
          mintLc = (colon >= 0 ? rest.slice(0, colon) : rest).toLowerCase();
          rule = colon >= 0 ? rest.slice(colon + 1) : null;
          if (rule === "RIP_BENCH" || rule === "WATCH_NEW") continue; // sticky owned by cool-clear + TTL
        } else {
          mintLc = name.slice(prefix.length).toLowerCase();
        }
        if (!mintLc || openMints.has(mintLc)) continue;
        await env.DESK_STATE.delete(name);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
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
  // RIP / WATCH extras
  if (payload.price_usd != null) body.price_usd = payload.price_usd;
  if (payload.m5 != null) body.m5 = payload.m5;
  if (payload.h1 != null) body.h1 = payload.h1;
  if (payload.buys_1h != null) body.buys_1h = payload.buys_1h;
  if (payload.sells_1h != null) body.sells_1h = payload.sells_1h;
  if (payload.hygiene != null) body.hygiene = payload.hygiene;
  if (payload.return_to_rip_bench) body.return_to_rip_bench = true;

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

  if (payload.stickyArm) {
    // Sticky until evaluatePosition clears rip_arm on drop-under; long TTL as belt
    await env.DESK_STATE.put(dedupeKey, body.ts, { expirationTtl: 60 * 60 * 24 * 30 });
  } else {
    await env.DESK_STATE.put(dedupeKey, body.ts, {
      expirationTtl: payload.dedupeSec,
    });
  }
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
