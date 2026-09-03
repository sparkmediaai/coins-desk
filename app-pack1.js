/* pack1 Holding overlay — pairAddress, trail-armed, scrub, 24h spark; no hunt impact-vs-mid */
(function () {
  if (typeof pairFields !== "function" || typeof renderTape !== "function") return;

  const _pairFields = pairFields;
  pairFields = function (pair) {
    const f = _pairFields(pair);
    f.pairAddress = pair && pair.pairAddress ? pair.pairAddress : null;
    f.pairUrl =
      (pair && pair.url) ||
      (f.pairAddress ? "https://dexscreener.com/solana/" + f.pairAddress : null);
    return f;
  };

  function dexHrefPair(pairAddress, mint) {
    if (pairAddress) return "https://dexscreener.com/solana/" + encodeURIComponent(pairAddress);
    return typeof dexHref === "function" ? dexHref(mint) : "#";
  }

  /* 24h sparkline — prefer Gecko OHLCV SVG; Dex link fallback; hide if no pair */
  const GECKO_OHLCV =
    "https://api.geckoterminal.com/api/v2/networks/solana/pools/";
  const SPARK_TTL_MS = 5 * 60 * 1000;
  const sparkCache = new Map();

  function sparkSvgFromCloses(closes, w, h) {
    const width = w || 96;
    const height = h || 28;
    const pad = 1;
    const vals = closes.filter((n) => Number.isFinite(n));
    if (vals.length < 2) return null;
    let lo = Math.min.apply(null, vals);
    let hi = Math.max.apply(null, vals);
    if (hi === lo) {
      hi += 1e-12;
      lo -= 1e-12;
    }
    const n = vals.length;
    const pts = vals
      .map((v, i) => {
        const x = pad + (i / (n - 1)) * (width - pad * 2);
        const y = pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
        return x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "spark");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-hidden", "true");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "var(--brass, #c9a227)");
    poly.setAttribute("stroke-width", "1.5");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("points", pts);
    svg.appendChild(poly);
    return svg;
  }

  async function fetchGeckoCloses(pairAddress) {
    const url =
      GECKO_OHLCV +
      encodeURIComponent(pairAddress) +
      "/ohlcv/hour?aggregate=1&limit=24";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("gecko " + res.status);
    const data = await res.json();
    const list =
      data &&
      data.data &&
      data.data.attributes &&
      data.data.attributes.ohlcv_list;
    if (!Array.isArray(list) || !list.length) throw new Error("gecko empty");
    const closes = list
      .slice()
      .reverse()
      .map((row) => (Array.isArray(row) ? Number(row[4]) : NaN))
      .filter((n) => Number.isFinite(n));
    if (closes.length < 2) throw new Error("gecko short");
    return closes;
  }

  async function getSparkCloses(pairAddress) {
    const hit = sparkCache.get(pairAddress);
    if (hit && Date.now() - hit.t < SPARK_TTL_MS) {
      if (hit.fail) throw new Error("cached fail");
      return hit.closes;
    }
    try {
      const closes = await fetchGeckoCloses(pairAddress);
      sparkCache.set(pairAddress, { t: Date.now(), closes });
      return closes;
    } catch (err) {
      sparkCache.set(pairAddress, { t: Date.now(), fail: true });
      throw err;
    }
  }

  function dexSparkFallback(pairAddress) {
    const a = el("a", "spark-fallback", "24h chart");
    a.href = dexHrefPair(pairAddress);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = "DexScreener 24h chart";
    return a;
  }

  function mountSparkLocal(host, pairAddress) {
    if (!host || !pairAddress) return;
    if (host.querySelector && host.querySelector(".spark-wrap")) return;
    const wrap = el("div", "spark-wrap");
    wrap.setAttribute("aria-hidden", "true");
    host.appendChild(wrap);
    const hit = sparkCache.get(pairAddress);
    if (hit && !hit.fail && hit.closes && Date.now() - hit.t < SPARK_TTL_MS) {
      const svg = sparkSvgFromCloses(hit.closes);
      if (svg) {
        wrap.replaceChildren(svg);
        return;
      }
    }
    getSparkCloses(pairAddress)
      .then((closes) => {
        if (!wrap.isConnected) return;
        const svg = sparkSvgFromCloses(closes);
        if (svg) wrap.replaceChildren(svg);
        else wrap.replaceChildren(dexSparkFallback(pairAddress));
      })
      .catch(() => {
        if (!wrap.isConnected) return;
        wrap.replaceChildren(dexSparkFallback(pairAddress));
      });
  }

  // Prefer app.js mountSpark when present; else local.
  const mountSparkFn =
    typeof mountSpark === "function" ? mountSpark : mountSparkLocal;

  function isTrailArmed(pos, vsFillPct) {
    if (vsFillPct != null && vsFillPct >= 20) return true;
    const bag = [...(pos.flags || []), ...(pos.exit_rules || [])].map((f) => String(f).toUpperCase());
    if (bag.some((f) => f === "TRAIL" || f === "TRAIL_ARMED" || f === "TRAIL_GIVEBACK" || f.startsWith("TRAIL_"))) {
      return true;
    }
    const trail = String(pos.trail || "").toUpperCase();
    if (trail && trail !== "OFF" && trail !== "0" && trail !== "FALSE" && trail !== "NO") {
      if (trail.includes("ARMED") || trail === "ON" || trail === "1" || trail === "TRUE") return true;
    }
    return false;
  }

  const _badgesFor = badgesFor;
  badgesFor = function (pos, opts) {
    const wrap = _badgesFor(pos);
    if (!wrap) {
      if (opts && opts.trailArmed) {
        const w = el("div", "badges");
        w.appendChild(el("span", "badge trail", "TRAIL ARMED"));
        return w;
      }
      return null;
    }
    if (opts && opts.trailArmed) {
      wrap.appendChild(el("span", "badge trail", "TRAIL ARMED"));
    }
    return wrap;
  };

  renderTape = function (positions, quotes) {
    const root = $("tape");
    if (!root) return;
    root.replaceChildren();
    const open = (positions || []).filter((pos) => {
      if (!pos || !pos.mint) return false;
      if (String(pos.status || "").toLowerCase() === "closed") return false;
      if (pos.sold_usd != null || pos.sold_at || pos.closed_at) return false;
      return true;
    });
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
      if (f.pairAddress) {
        const pairLine = el("div", "row-pair");
        pairLine.appendChild(document.createTextNode("pair " + shortMint(f.pairAddress) + " "));
        const pa = el("a", null, "dex");
        pa.href = dexHrefPair(f.pairAddress, pos.mint);
        pa.target = "_blank";
        pa.rel = "noopener noreferrer";
        pairLine.appendChild(pa);
        id.appendChild(pairLine);
      }
      mountSparkFn(id, f.pairAddress);
      const badges = badgesFor(flagged, { trailArmed: isTrailArmed(pos, vsFillPct) });
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
  };

  renderAll = function (fillsData, quotes, solUsd) {
    const w = $("wallet");
    if (w) w.textContent = shortWallet(fillsData.desk && fillsData.desk.wallet);
    const open = Array.isArray(fillsData.positions) ? fillsData.positions : [];
    const closed = Array.isArray(fillsData.closed) ? fillsData.closed : [];
    renderTicks(open, fillsData.hunt, fillsData.watch, quotes, solUsd);
    renderTape(open, quotes);
    renderClosed(closed, quotes);
    // Hunt: quotes only — no impact-vs-mid
    renderHunt(fillsData.hunt, quotes);
    renderWatch(fillsData.watch, quotes);
    renderBook(Object.assign({}, fillsData, { positions: open }), quotes, solUsd);
  };

  if (typeof refresh === "function") refresh();
})();
