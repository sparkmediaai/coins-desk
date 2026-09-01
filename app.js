const FILLS_URL = "./fills.json";
const DEX = "https://api.dexscreener.com/latest/dex/tokens/";
const WSOL = "So11111111111111111111111111111111111111112";
const TZ = "America/Los_Angeles";
const REFRESH_MS = 30000;

const $ = (id) => document.getElementById(id);

let fills = null;
let lastQuotes = null;

function shortWallet(addr) {
  if (!addr || addr.length < 8) return addr || "—";
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function shortMint(addr) {
  if (!addr || addr.length < 8) return addr || "—";
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mainPair(pairs) {
  const sol = (pairs || []).filter((p) => p && p.chainId === "solana");
  sol.sort((a, b) => {
    const la = (a.liquidity && a.liquidity.usd) || 0;
    const lb = (b.liquidity && b.liquidity.usd) || 0;
    return lb - la;
  });
  return sol[0] || null;
}

function solUsdFromWsol(pair) {
  const px = num(pair && pair.priceUsd);
  return px && px > 0 ? px : null;
}

function solUsdFromQuote(pair) {
  if (!pair) return null;
  const usd = num(pair.priceUsd);
  const native = num(pair.priceNative);
  if (usd && native && native > 0) return usd / native;
  return null;
}

function liveClip(pos, livePrice) {
  if (livePrice == null || livePrice <= 0) return null;
  const amt = num(pos.fill_token_amount);
  if (amt != null) return amt * livePrice;
  const fillUsd = num(pos.fill_usd);
  const fillPx = num(pos.fill_price_usd);
  if (fillUsd == null || fillPx == null || fillPx <= 0) return null;
  return fillUsd * (livePrice / fillPx);
}

function fmtPx(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 100) return n.toFixed(2);
  if (a >= 1) return n.toFixed(4);
  if (a >= 0.01) return n.toFixed(5);
  return n.toPrecision(4);
}

function fmtUsd(n, digits) {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toFixed(digits == null ? 2 : digits);
}

function fmtLiq(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "m";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return fmtUsd(n, 0);
}

function fmtVol(n) {
  return fmtLiq(n);
}

function fmtAge(ts) {
  const t = num(ts);
  if (t == null) return "—";
  const ms = t < 1e12 ? t * 1000 : t;
  const ageMs = Date.now() - ms;
  if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
  const hours = ageMs / 3600000;
  if (hours < 24) return (hours < 10 ? hours.toFixed(1) : hours.toFixed(0)) + "h";
  const days = hours / 24;
  return (days < 10 ? days.toFixed(1) : days.toFixed(0)) + "d";
}

function fmtFilledAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return s.replace(" AM", "am").replace(" PM", "pm") + " PT";
}

function fmtPct(n) {
  if (n == null) return { text: "—", cls: "flat" };
  const cls = n > 0 ? "up" : n < 0 ? "dn" : "flat";
  const sign = n > 0 ? "+" : "";
  return { text: sign + n.toFixed(2) + "%", cls };
}

function signedUsd(n) {
  if (n == null) return { text: "—", cls: "flat" };
  const cls = n > 0 ? "up" : n < 0 ? "dn" : "flat";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return { text: sign + "$" + Math.abs(n).toFixed(2), cls };
}

function dexHref(mint) {
  return "https://dexscreener.com/solana/" + encodeURIComponent(mint);
}

function solscanToken(mint) {
  return "https://solscan.io/token/" + encodeURIComponent(mint);
}

function solscanAccount(addr) {
  return "https://solscan.io/account/" + encodeURIComponent(addr);
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function metric(label, value, cls) {
  const box = el("div", "m");
  box.appendChild(el("span", "m-k", label));
  box.appendChild(el("span", "m-v" + (cls ? " " + cls : ""), value));
  return box;
}

function tickerCell(row) {
  const id = el("div", "row-id");
  const t = el("div", "row-ticker");
  const a = el("a", null, row.ticker);
  a.href = dexHref(row.mint);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  t.appendChild(a);
  id.appendChild(t);
  if (row.name) id.appendChild(el("div", "row-name", row.name));
  if (row.mint) {
    const mintLine = el("div", "row-mint");
    mintLine.appendChild(document.createTextNode(shortMint(row.mint) + " "));
    const dex = el("a", null, "dex");
    dex.href = dexHref(row.mint);
    dex.target = "_blank";
    dex.rel = "noopener noreferrer";
    mintLine.appendChild(dex);
    mintLine.appendChild(document.createTextNode(" "));
    const sol = el("a", null, "solscan");
    sol.href = solscanToken(row.mint);
    sol.target = "_blank";
    sol.rel = "noopener noreferrer";
    mintLine.appendChild(sol);
    id.appendChild(mintLine);
  }
  return id;
}

function badgesFor(pos) {
  const wrap = el("div", "badges");
  if (pos.fill_price_estimated) wrap.appendChild(el("span", "badge est", "EST"));
  for (const flag of pos.flags || []) {
    const name = String(flag).toUpperCase();
    const extra = name === "WHIP" ? " whip" : name === "CUT" ? " cut" : "";
    wrap.appendChild(el("span", "badge" + extra, name));
  }
  if (pos.holding) wrap.appendChild(el("span", "badge hold", "HOLDING"));
  if (pos.clips) {
    wrap.appendChild(
      el("span", "badge clips", pos.clips + (pos.clips === 1 ? " CLIP" : " CLIPS"))
    );
  }
  return wrap.childNodes.length ? wrap : null;
}

function pairFields(pair) {
  if (!pair) {
    return {
      price: null,
      h1: null,
      h6: null,
      h24: null,
      m5: null,
      liq: null,
      buys: null,
      sells: null,
      dexId: null,
      volH1: null,
      volH24: null,
      marketCap: null,
      fdv: null,
      pairCreatedAt: null,
    };
  }
  const ch = pair.priceChange || {};
  const tx = (pair.txns && pair.txns.h1) || {};
  const vol = pair.volume || {};
  return {
    price: num(pair.priceUsd),
    h1: num(ch.h1),
    h6: num(ch.h6),
    h24: num(ch.h24),
    m5: num(ch.m5),
    liq: pair.liquidity ? num(pair.liquidity.usd) : null,
    buys: num(tx.buys),
    sells: num(tx.sells),
    dexId: pair.dexId || null,
    volH1: num(vol.h1),
    volH24: num(vol.h24),
    marketCap: num(pair.marketCap),
    fdv: num(pair.fdv),
    pairCreatedAt: num(pair.pairCreatedAt),
  };
}

function quoteOf(quotes, mint) {
  return quotes && quotes[mint] ? quotes[mint] : null;
}

function bs(f) {
  if (f.buys == null && f.sells == null) return "—";
  return (f.buys ?? "—") + "/" + (f.sells ?? "—");
}

function rowMore(f) {
  const strip = el("div", "row-more");
  const h6 = fmtPct(f.h6);
  const h24 = fmtPct(f.h24);
  strip.appendChild(metric("6h", h6.text, h6.cls));
  strip.appendChild(metric("24h", h24.text, h24.cls));
  strip.appendChild(metric("vol 1h", fmtVol(f.volH1)));
  strip.appendChild(metric("vol 24h", fmtVol(f.volH24)));
  strip.appendChild(metric("mcap", fmtLiq(f.marketCap)));
  strip.appendChild(metric("pair age", fmtAge(f.pairCreatedAt)));
  strip.appendChild(metric("dex", f.dexId || "—"));
  return strip;
}

function setStatus(kind, label) {
  const pill = $("feed-pill");
  if (!pill) return;
  pill.textContent = label;
  pill.className = "pill" + (kind === "live" ? " live" : kind === "stale" ? " stale" : " err");
}

function tickClock() {
  const now = new Date();
  const clock = $("clock");
  const date = $("clock-date");
  if (clock) {
    clock.textContent = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(now);
  }
  if (date) {
    date.textContent = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(now);
  }
}

function stampUpdate() {
  const elu = $("last-update");
  if (!elu) return;
  elu.textContent =
    "last " +
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date());
}

async function loadFills() {
  const res = await fetch(FILLS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("fills " + res.status);
  return res.json();
}

async function fetchToken(mint) {
  const res = await fetch(DEX + encodeURIComponent(mint), { cache: "no-store" });
  if (!res.ok) throw new Error("dex " + mint + " " + res.status);
  const data = await res.json();
  return mainPair(data.pairs);
}

function appendMetrics(row, items) {
  const metrics = el("div", "row-metrics");
  for (const item of items) metrics.appendChild(item);
  row.appendChild(metrics);
}

function tdNum(text, cls) {
  return el("td", "num" + (cls ? " " + cls : ""), text);
}

function renderTape(positions, quotes) {
  const root = $("tape");
  if (!root) return;
  root.replaceChildren();
  const open = positions || [];
  if (!open.length) {
    const tr = el("tr", "muted-row");
    const td = el("td", null, "No open clips. Sitting SOL.");
    td.colSpan = 10;
    tr.appendChild(td);
    root.appendChild(tr);
    return;
  }
  for (const pos of open) {
    const f = pairFields(quoteOf(quotes, pos.mint));
    const clip = liveClip(pos, f.price);
    const fillUsd = num(pos.fill_usd);
    const pnl = clip != null && fillUsd != null ? clip - fillUsd : null;
    const vsFillPct =
      clip != null && fillUsd != null && fillUsd !== 0 ? ((clip - fillUsd) / fillUsd) * 100 : null;
    const h1 = fmtPct(f.h1);
    const m5 = fmtPct(f.m5);
    const vs = fmtPct(vsFillPct);
    const pnlFmt = signedUsd(pnl);
    const tr = el("tr", "holding");
    const flagged = Object.assign({}, pos, { holding: true });
    const id = tickerCell(flagged);
    const badges = badgesFor(flagged);
    if (badges) id.appendChild(badges);
    id.appendChild(rowMore(f));
    const tdId = el("td");
    tdId.appendChild(id);
    tr.appendChild(tdId);
    tr.appendChild(tdNum(f.price == null ? "—" : "$" + fmtPx(f.price)));
    tr.appendChild(tdNum(h1.text, h1.cls));
    tr.appendChild(tdNum(m5.text, m5.cls));
    tr.appendChild(tdNum(fmtLiq(f.liq)));
    tr.appendChild(tdNum(bs(f)));
    tr.appendChild(tdNum(fmtUsd(clip)));
    tr.appendChild(tdNum(vs.text, vs.cls));
    tr.appendChild(tdNum(fmtUsd(fillUsd)));
    tr.appendChild(tdNum(pnlFmt.text, pnlFmt.cls));
    root.appendChild(tr);
  }
}

function renderClosed(closed, quotes) {
  const root = $("closed");
  if (!root) return;
  root.replaceChildren();
  const done = closed || [];
  if (!done.length) {
    const tr = el("tr", "muted-row");
    const td = el("td", null, "No closed clips.");
    td.colSpan = 10;
    tr.appendChild(td);
    root.appendChild(tr);
    return;
  }
  for (const pos of done) {
    const f = pairFields(quoteOf(quotes, pos.mint));
    const fillUsd = num(pos.fill_usd);
    const soldUsd = num(pos.sold_usd);
    const pnl = soldUsd != null && fillUsd != null ? soldUsd - fillUsd : null;
    const vsFillPct =
      soldUsd != null && fillUsd != null && fillUsd !== 0 ? ((soldUsd - fillUsd) / fillUsd) * 100 : null;
    const h1 = fmtPct(f.h1);
    const m5 = fmtPct(f.m5);
    const vs = fmtPct(vsFillPct);
    const pnlFmt = signedUsd(pnl);
    const flags = Object.assign({}, pos, { flags: Array.from(new Set([...(pos.flags || []), "CUT"])) });
    const tr = el("tr", "cut");
    const id = tickerCell(flags);
    const badges = badgesFor(flags);
    if (badges) id.appendChild(badges);
    if (pos.note) id.appendChild(el("div", "row-note", pos.note));
    id.appendChild(rowMore(f));
    const tdId = el("td");
    tdId.appendChild(id);
    tr.appendChild(tdId);
    tr.appendChild(tdNum(f.price == null ? "—" : "$" + fmtPx(f.price)));
    tr.appendChild(tdNum(h1.text, h1.cls));
    tr.appendChild(tdNum(m5.text, m5.cls));
    tr.appendChild(tdNum(fmtLiq(f.liq)));
    tr.appendChild(tdNum(bs(f)));
    tr.appendChild(tdNum(fmtUsd(soldUsd)));
    tr.appendChild(tdNum(vs.text, vs.cls));
    tr.appendChild(tdNum(fmtUsd(fillUsd)));
    tr.appendChild(tdNum(pnlFmt.text, pnlFmt.cls));
    root.appendChild(tr);
  }
}

function renderHunt(rows, quotes) {
  const root = $("hunt");
  root.replaceChildren();
  if (!rows || !rows.length) {
    root.appendChild(el("div", "row muted", "Empty bench."));
    return;
  }
  for (const item of rows) {
    const f = pairFields(quoteOf(quotes, item.mint));
    const h1 = fmtPct(f.h1);
    const m5 = fmtPct(f.m5);
    const row = el("div", "row");
    row.appendChild(tickerCell(item));
    const metrics = el("div", "row-metrics");
    metrics.appendChild(metric("price", f.price == null ? "—" : "$" + fmtPx(f.price)));
    metrics.appendChild(metric("1h", h1.text, h1.cls));
    metrics.appendChild(metric("5m", m5.text, m5.cls));
    metrics.appendChild(metric("liq", fmtLiq(f.liq)));
    metrics.appendChild(metric("1h b/s", bs(f)));
    row.appendChild(metrics);
    if (item.note) row.appendChild(el("div", "row-note", item.note));
    row.appendChild(rowMore(f));
    root.appendChild(row);
  }
}

function renderWatch(rows, quotes) {
  const root = $("watch");
  root.replaceChildren();
  if (!rows || !rows.length) {
    root.appendChild(el("div", "row muted", "Empty watch."));
    return;
  }
  for (const item of rows) {
    const f = pairFields(quoteOf(quotes, item.mint));
    const onCurve = f.dexId === "pumpfun";
    const curve = f.dexId == null ? "—" : onCurve ? "on-curve" : "graduated";
    const h1 = fmtPct(f.h1);
    const m5 = fmtPct(f.m5);
    const row = el("div", "row");
    const id = tickerCell(item);
    const badge = el("div", "badges");
    badge.appendChild(el("span", "badge " + (onCurve ? "curve" : "grad"), curve));
    id.appendChild(badge);
    row.appendChild(id);
    const metrics = el("div", "row-metrics");
    metrics.appendChild(metric("curve", curve, onCurve ? "curve" : "flat"));
    metrics.appendChild(metric("price", f.price == null ? "—" : "$" + fmtPx(f.price)));
    metrics.appendChild(metric("1h", h1.text, h1.cls));
    metrics.appendChild(metric("5m", m5.text, m5.cls));
    metrics.appendChild(metric("liq", fmtLiq(f.liq)));
    row.appendChild(metrics);
    if (item.note) row.appendChild(el("div", "row-note", item.note));
    row.appendChild(rowMore(f));
    root.appendChild(row);
  }
}

function renderTicks(positions, hunt, watch, quotes, solUsd) {
  const stripe = $("tick-stripe");
  const bits = [];
  if (solUsd != null) {
    bits.push({ t: "SOL", px: solUsd, h1: null });
  }
  for (const list of [positions, hunt, watch]) {
    for (const row of list || []) {
      const f = pairFields(quoteOf(quotes, row.mint));
      bits.push({ t: row.ticker, px: f.price, h1: f.h1 });
    }
  }
  if (!bits.length) {
    stripe.replaceChildren(el("span", "tick-item muted", "WAITING QUOTES…"));
    return;
  }
  const frag = document.createDocumentFragment();
  const twice = bits.concat(bits);
  for (const b of twice) {
    const pct = fmtPct(b.h1);
    const span = el(
      "span",
      "tick-item" + (b.h1 == null ? "" : " " + pct.cls),
      b.t + "  " + (b.px == null ? "—" : "$" + fmtPx(b.px)) + (b.h1 == null ? "" : "  " + pct.text)
    );
    frag.appendChild(span);
  }
  stripe.replaceChildren(frag);
}

function renderBook(fillsData, quotes, solUsd) {
  let clipSum = 0;
  let fillSum = 0;
  let haveClip = false;
  for (const pos of fillsData.positions || []) {
    const f = pairFields(quoteOf(quotes, pos.mint));
    const clip = liveClip(pos, f.price);
    const fillUsd = num(pos.fill_usd);
    if (fillUsd != null) fillSum += fillUsd;
    if (clip != null) {
      clipSum += clip;
      haveClip = true;
    }
  }
  const leftover = num(fillsData.leftover_sol) || 0;
  const leftoverUsd = solUsd != null ? leftover * solUsd : null;
  const book =
    haveClip && leftoverUsd != null
      ? clipSum + leftoverUsd
      : haveClip && leftover === 0
        ? clipSum
        : null;

  const bookEl = $("book-num");
  if (bookEl) {
    bookEl.textContent = fmtUsd(book);
    const start = num(fillsData.desk && fillsData.desk.start_usd);
    bookEl.className = "book-num" + (book != null && start != null && book < start ? " dn" : "");
  }

  const vsFill = $("vs-fill");
  if (vsFill) {
    const d = haveClip ? clipSum - fillSum : null;
    const s = signedUsd(d);
    vsFill.textContent = s.text;
    vsFill.className = "stat-val " + s.cls;
  }

  const vsStart = $("vs-start");
  if (vsStart) {
    const start = num(fillsData.desk && fillsData.desk.start_usd);
    const d = book != null && start != null ? book - start : null;
    const s = signedUsd(d);
    vsStart.textContent = s.text;
    vsStart.className = "stat-val " + s.cls;
  }

  const leftEl = $("leftover");
  if (leftEl) {
    leftEl.textContent =
      leftover.toFixed(4) + " SOL" + (leftoverUsd != null ? " · " + fmtUsd(leftoverUsd) : "");
  }

  const solPx = $("sol-px");
  if (solPx) {
    solPx.textContent = solUsd == null ? "—" : "$" + solUsd.toFixed(2);
  }

  const filledAt = $("filled-at");
  if (filledAt) {
    filledAt.textContent = fmtFilledAt(fillsData.desk && fillsData.desk.filled_at);
  }
}

function renderAll(fillsData, quotes, solUsd) {
  const w = $("wallet");
  if (w) w.textContent = shortWallet(fillsData.desk && fillsData.desk.wallet);
  renderTicks(fillsData.positions, fillsData.hunt, fillsData.watch, quotes, solUsd);
  renderTape(fillsData.positions, quotes);
  renderClosed(fillsData.closed, quotes);
  renderHunt(fillsData.hunt, quotes);
  renderWatch(fillsData.watch, quotes);
  renderBook(fillsData, quotes, solUsd);
}

async function refresh() {
  try {
    fills = await loadFills();
  } catch (err) {
    setStatus("error", "ERROR");
    const elu = $("last-update");
    if (elu) elu.textContent = "fills.json failed";
    return;
  }

  const mints = new Set([WSOL]);
  for (const list of [fills.positions, fills.closed, fills.hunt, fills.watch]) {
    for (const row of list || []) {
      if (row.mint) mints.add(row.mint);
    }
  }

  const quotes = {};
  let failures = 0;
  const results = await Promise.all(
    [...mints].map(async (mint) => {
      try {
        const pair = await fetchToken(mint);
        return { mint, pair, ok: true };
      } catch (err) {
        return { mint, pair: null, ok: false };
      }
    })
  );

  let solUsd = null;
  for (const r of results) {
    if (!r.ok) {
      failures += 1;
      continue;
    }
    quotes[r.mint] = r.pair;
    if (r.mint === WSOL) solUsd = solUsdFromWsol(r.pair);
  }
  if (solUsd == null) {
    for (const r of results) {
      if (r.ok && r.pair) {
        solUsd = solUsdFromQuote(r.pair);
        if (solUsd != null) break;
      }
    }
  }

  const gotAny = Object.keys(quotes).length > 0;
  if (gotAny) {
    lastQuotes = quotes;
    renderAll(fills, quotes, solUsd);
    setStatus(failures === 0 ? "live" : "stale", failures === 0 ? "LIVE" : "STALE");
    stampUpdate();
  } else if (lastQuotes) {
    const wsol = lastQuotes[WSOL];
    const fallbackSol =
      solUsdFromWsol(wsol) || solUsdFromQuote(Object.values(lastQuotes).find(Boolean));
    renderAll(fills, lastQuotes, fallbackSol);
    setStatus("stale", "STALE");
  } else {
    renderAll(fills, {}, null);
    setStatus("error", "ERROR");
  }
}

tickClock();
setInterval(tickClock, 1000);
refresh();
setInterval(refresh, REFRESH_MS);
