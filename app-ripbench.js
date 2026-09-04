/* RIP_BENCH overlay — curated rip-watch from fills.rip_bench */
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
      ".rip-bench .row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:2px 12px;padding:10px 0;border-bottom:1px solid var(--brass-hair-2);align-items:start}",
      ".rip-bench .row.rip-open{background:var(--lime-wash);box-shadow:inset 3px 0 0 var(--lime);padding-left:8px;margin-left:-8px}",
      ".rip-mint{font-size:11px;color:var(--smoke);font-variant-numeric:tabular-nums;align-self:center}",
      ".rip-mint a{color:var(--brass-dim)}",
      ".rip-mint a:hover{color:var(--brass)}",
      ".rip-bench .row-note.rip-note{grid-column:1/-1;margin-top:2px;font-size:11px;color:var(--smoke);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}",
      "@media (min-width:820px){",
      ".rip-bench-head{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr) minmax(0,2.2fr);gap:8px;padding:0 0 8px;color:var(--mute-2);font-size:10px;letter-spacing:.1em;text-transform:uppercase;border-bottom:1px solid var(--line)}",
      ".rip-bench .row{grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr) minmax(0,2.2fr);align-items:center;gap:8px}",
      ".rip-bench .row-note.rip-note{grid-column:auto;margin-top:0;-webkit-line-clamp:2}",
      "}"
    ].join("");
    document.head.appendChild(s);
  }

  function renderRipBench(rows, positions, desk) {
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
        list.length + " name" + (list.length === 1 ? "" : "s") + ". " + pctTxt + ". open marked OPEN.";
    }
    const countEl = $("rip-bench-count");
    if (countEl) countEl.textContent = "(" + list.length + ")";
    if (!list.length) {
      root.appendChild(el("div", "row muted", "Empty rip watch."));
      return;
    }
    for (const item of list) {
      const isOpen = open.has(item.mint);
      const row = el("div", "row" + (isOpen ? " rip-open" : ""));
      const id = el("div", "row-id");
      const tick = el("div", "row-ticker");
      const a = el("a", null, item.ticker || "\u2014");
      a.href = dexHref(item.mint);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      tick.appendChild(a);
      id.appendChild(tick);
      if (isOpen) {
        const badges = el("div", "badges");
        badges.appendChild(el("span", "badge hold", "OPEN"));
        id.appendChild(badges);
      }
      row.appendChild(id);
      const mintCell = el("div", "rip-mint");
      const ma = el("a", null, shortMint(item.mint));
      ma.href = dexHref(item.mint);
      ma.target = "_blank";
      ma.rel = "noopener noreferrer";
      mintCell.appendChild(ma);
      row.appendChild(mintCell);
      const snip = noteSnippet(item.note, 88);
      row.appendChild(el("div", "row-note rip-note", snip || "\u2014"));
      root.appendChild(row);
    }
  }

  const _renderAll = renderAll;
  renderAll = function (fillsData, quotes, solUsd) {
    _renderAll(fillsData, quotes, solUsd);
    const open = Array.isArray(fillsData.positions) ? fillsData.positions : [];
    renderRipBench(fillsData.rip_bench, open, fillsData.desk);
  };

  if (typeof refresh === "function") refresh();
})();
