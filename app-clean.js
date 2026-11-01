/* clean overlay: Holding = OPEN positions only, summed per mint; closed = post-reset only, deduped;
   USD from each trade's own SOL price, else marked "~" (estimated). Shows "N hidden" counts. Display only; never writes data. */
(function(){
  if(typeof renderAll!=="function")return;
  var EST_TIP="Estimated: no SOL/USD recorded for this trade; converted at the reset SOL price.";
  function t(x){var v=Date.parse(x||"");return isNaN(v)?null:v;}
  function n0(x){return num(x)||0;}
  function isOpen(p){
    if(!p||!p.mint)return false;
    var st=String(p.status||"").toUpperCase(),act=String(p.action||"").toUpperCase();
    if(st!=="OPEN")return false;
    if(act&&act!=="BUY"&&act!=="FILL")return false;
    if(p.sold_usd!=null||p.sold_at||p.closed_at)return false;
    var tok=num(p.fill_token_amount)??num(p.tokens);return tok==null||tok>0;
  }
  function closedTs(c){return t(c.closed_at)??t(c.sold_at)??t(c.ts_pt)??t(c.filled_at);}
  function ownPx(c){
    var px=num(c.sol_usd)??num(c.sol_usd_at_fill)??num(c.sol_usd_at_close);
    if(px)return px;
    var fu=num(c.fill_usd),fs=num(c.fill_sol);
    if(fu!=null&&fs&&!/approx|reset/i.test(c.fill_usd_note||""))return fu/fs;
    return null;
  }
  function sumByMint(list){
    var m=new Map();
    list.forEach(function(p){
      var o=m.get(p.mint);
      if(!o){m.set(p.mint,Object.assign({},p,{_rows:1}));return;}
      ["tokens","fill_token_amount","fill_sol","fill_usd"].forEach(function(k){if(p[k]!=null||o[k]!=null)o[k]=n0(o[k])+n0(p[k]);});
      o.clips=n0(o.clips||1)+n0(p.clips||1);o._rows++;
      if((t(p.filled_at)||0)>(t(o.filled_at)||0))o.filled_at=p.filled_at;
      o.flags=Array.from(new Set([].concat(o.flags||[],p.flags||[])));
    });
    return Array.from(m.values()).map(function(o){var tk=num(o.fill_token_amount)??num(o.tokens),fu=num(o.fill_usd);if(tk&&fu!=null)o.fill_price_usd=fu/tk;return o;});
  }
  var last={hHidden:0,cHidden:0,closed:[]};
  function clean(f,solUsd){
    var desk=f.desk||{},reset=t(desk.start_reset_at),resetPx=num(desk.sol_usd_at_reset)||solUsd;
    var rawP=Array.isArray(f.positions)?f.positions:[],open=rawP.filter(isOpen);
    var pos=sumByMint(open);
    var rawC=Array.isArray(f.closed)?f.closed:[],seen=new Set(),closed=[];
    rawC.forEach(function(c){
      if(!c||String(c.status||"").toUpperCase()!=="CLOSED")return;
      var ct=closedTs(c);if(reset!=null&&ct!=null&&ct<reset)return;
      var k=c.exit_tx||c.tx||c.fill_tx||(c.mint+"|"+(c.closed_at||c.ts_pt||c.filled_at));if(seen.has(k))return;seen.add(k);
      var x=Object.assign({},c),px=ownPx(c),est=false;
      if(x.closed_at==null&&x.sold_at==null){x.closed_at=c.ts_pt||c.filled_at||null;x._tsFallback=true;}
      if(/approx/i.test(c.sold_usd_note||""))est=true;
      var usePx=px||resetPx;if(!px)est=true;
      if(x.fill_usd==null&&num(c.fill_sol)!=null&&usePx)x.fill_usd=+(num(c.fill_sol)*usePx).toFixed(2);
      if(x.sold_usd==null&&num(c.sold_sol)!=null&&usePx)x.sold_usd=+(num(c.sold_sol)*usePx).toFixed(2);
      if(x.pnl_usd==null&&num(c.pnl_sol)!=null&&usePx)x.pnl_usd=+(num(c.pnl_sol)*usePx).toFixed(2);
      x._est=est&&(x.sold_usd!=null||x.fill_usd!=null);closed.push(x);
    });
    last.hHidden=rawP.length-open.length;last.cHidden=rawC.length-closed.length;
    last.closed=closed.slice().sort(function(a,b){var ta=t(a.closed_at||a.sold_at||a.filled_at),tb=t(b.closed_at||b.sold_at||b.filled_at);return(tb??-Infinity)-(ta??-Infinity);});
    return Object.assign({},f,{positions:pos,closed:closed});
  }
  function hiddenNote(id,after,n,what){
    var e=$(id);
    if(!e&&after){e=el("div","sub hidden-note");e.id=id;e.style.cssText="font-size:12px;opacity:.65;margin-top:6px";after.insertAdjacentElement("afterend",e);}
    if(e){e.textContent=n>0?n+" hidden ("+what+")":"";e.hidden=!(n>0);}
  }
  function decorate(){
    var tape=$("tape");hiddenNote("holding-hidden",tape&&tape.closest("table"),last.hHidden,"closed, sold or duplicate records");
    var rows=[].concat(Array.from(($("closed")||{children:[]}).children),Array.from(($("closed-more")||{children:[]}).children)).filter(function(r){return !r.classList.contains("muted-row");});
    rows.forEach(function(r,i){var c=last.closed[i];if(!c)return;
      if(c._est)[2,3,4].forEach(function(j){var td=r.children[j];if(td&&td.textContent!=="—"&&td.textContent.charAt(0)!=="~"){td.textContent="~"+td.textContent;td.title=EST_TIP;}});
      if(c._tsFallback&&r.children[1])r.children[1].title="No close time recorded; showing the fill time.";});
    var sum=$("closed-summary");if(sum&&last.cHidden>0)sum.appendChild(document.createTextNode(" · "+last.cHidden+" hidden (pre-reset, open or duplicate)"));
  }
  var _ra=renderAll;
  renderAll=function(f,q,s){_ra(clean(f,s),q,s);try{decorate();}catch(e){}};
  if(typeof refresh==="function")refresh();
})();
