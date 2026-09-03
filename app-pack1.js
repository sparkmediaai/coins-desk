/* pack1 Holding overlay — pairAddress, trail-armed, scrub; no hunt impact-vs-mid */
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
