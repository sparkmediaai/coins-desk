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
  // Accept CT/override fills that use `tokens` (curve names) as well as fill_token_amount.
  const amt =
    num(pos.fill_token_amount) ?? num(pos.tokens) ?? num(pos.token_amount);
  if (amt != null) return amt * livePrice;
  const fillUsd = num(pos.fill_usd);
  let fillPx = num(pos.fill_price_usd);
  // Derive fill px when only fill_usd + tokens exist (null liq / curve fills).
  if (fillPx == null || fillPx <= 0) {
    const toks = num(pos.fill_token_amount) ?? num(pos.tokens) ?? num(pos.token_amount);
    if (fillUsd != null && toks != null && toks > 0) fillPx = fillUsd / toks;
  }
  if (fillUsd == null || fillPx == null || fillPx <= 0) return null;
  return fillUsd * (livePrice / fillPx);
}
