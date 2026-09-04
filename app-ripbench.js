/* RIP_BENCH overlay — Dex live marks like Holding/hunt */
(function () {
  if (typeof renderAll !== "function" || typeof $ !== "function") return;

  function noteSnippet(note, max) {
    if (!note) return "";
    const s = String(note).trim();
    const lim = max || 72;
    return s.length > lim ? s.slice(0, lim - 1) + "\u2026" : s;
  }

  function openMintSet(positions) {
    const set = new Set();
    for (const p of positions || []) {
      if (!p || !p.mint) continue;
      const st = String(p.status || "").toLowerCase();
      if (st === "closed" || p.sold_usd != null || p.sold_at || p.closed_at) continue;
      set.add(p.mint);
    }
    return set;
  }

  function ensureRipBenchStyles() {
    if (document.getElementById("rip-bench-style")) return;
    const s = document.createElement("style");
    s.id = "rip-bench-style";
    s.textContent = [
      ".panel-count{margin-left:.35em;color:var(--brass);font-family:var(--mono);font-size:14px;font-weight:500;letter-spacing:.06em}",
      ".rip-bench-head{display:none}",
      ".rip-bench .row{display:block;padding:10px 0;border-bottom:1px solid var(--brass-hair-2)}",
      ".rip-bench .row.rip-open{background:var(--lime-wash);box-shadow:inset 3px 0 0 var(--lime);padding-left:8px;margin-left:-8px}",
      ".rip-bench .row-metrics{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:6px}",
      ".rip-bench .row-more{margin-top:4px}",
      ".rip-bench .row-note{margin-top:4px;font-size:11px;color:var(--smoke);line-height:1.4}"
    ].join("");
    document.head.appendChild(s);
  }

  function renderRipBench(rows, positions, desk, quotes) {
    ensureRipBenchStyles();
    const root = $("rip-bench");
    if (!root) return;
    root.replaceChildren();
    const open = openMintSet(positions);
    const list = (rows || []).filter((r) => r && r.mint);
    const pct = typeof num === "function" ? num(desk && desk.rip_bench_fill_pct) : null;
    const pctTxt = pct != null ? Math.round(pct * 100) + "% auto-clip on rip" : "curated rebuy list";
    const noteEl = $("rip-bench-note");
    if (noteEl) {
      noteEl.textContent =
        list.length + " name" + (list.length === 1 ? "" : "s") + ". " + pctTxt + ". Dex live marks. open marked OPEN.";
    }
    const countEl = $("rip-bench-count");
    if (countEl) countEl.textContent = "(" + list.length + ")";
    if (!list.length) {
      root.appendChild(el("div", "row muted", "Empty rip watch."));
      return;
    }
    for (const item of list) {
      const isOpen = open.has(item.mint);
      const q = typeof pairFields === "function" ? pairFields(quoteOf(quotes, item.mint)) : {};
      const h1 = typeof fmtPct === "function" ? fmtPct(q.h1) : { text: "\u2014", cls: "flat" };
      const m5 = typeof fmtPct === "function" ? fmtPct(q.m5) : { text: "\u2014", cls: "flat" };
      const row = el("div", "row" + (isOpen ? " rip-open" : ""));
      const id = typeof tickerCell === "function" ? tickerCell(item) : el("div", "row-id", item.ticker || "\u2014");
      if (isOpen) {
        const badges = el("div", "badges");
        badges.appendChild(el("span", "badge hold", "OPEN"));
        id.appendChild(badges);
      }
      row.appendChild(id);
      const metrics = el("div", "row-metrics");
      metrics.appendChild(metric("price", q.price == null ? "\u2014" : "$" + fmtPx(q.price)));
      metrics.appendChild(metric("1h", h1.text, h1.cls));
      metrics.appendChild(metric("5m", m5.text, m5.cls));
      metrics.appendChild(metric("liq", fmtLiq(q.liq)));
      metrics.appendChild(metric("1h b/s", bs(q)));
      row.appendChild(metrics);
      if (item.note) row.appendChild(el("div", "row-note", noteSnippet(item.note, 88)));
      if (typeof rowMore === "function") row.appendChild(rowMore(q));
      root.appendChild(row);
    }
  }

  const _renderAll = renderAll;
  renderAll = function (fillsData, quotes, solUsd) {
    _renderAll(fillsData, quotes, solUsd);
    const open = Array.isArray(fillsData.positions) ? fillsData.positions : [];
    renderRipBench(fillsData.rip_bench, open, fillsData.desk, quotes);
  };

  if (typeof refresh === "function") refresh();
})();
