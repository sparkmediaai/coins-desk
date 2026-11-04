/* 11/04 PAPER play wallet panel. Reads ./paper_play.json only (written by live-desk/paper/paper_common.mark_to_market).
   Fully separate from the real-wallet book: never touches fills.json, paper_fills.json, or the book/tape/closed panels. */
(function(){
  const URL_="./paper_play.json",TZ="America/Los_Angeles",$=id=>document.getElementById(id);
  const usd=v=>v==null?"\u2014":(v<0?"\u2212":"")+"$"+Math.abs(v).toFixed(2);
  const sol=v=>v==null?"\u2014":Number(v).toFixed(4)+" SOL";
  const cls=v=>v==null?"flat":v>0?"up":v<0?"dn":"flat";
  const pt=t=>{const d=new Date(t);return isNaN(d)?"\u2014":new Intl.DateTimeFormat("en-US",{timeZone:TZ,month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true}).format(d)+" PT"};
  const td=(t,c)=>{const e=document.createElement("td");e.textContent=t;if(c)e.className=c;return e};
  function row(cells){const tr=document.createElement("tr");cells.forEach(c=>tr.appendChild(c));return tr}
  async function load(){
    let s;try{const r=await fetch(URL_,{cache:"no-store"});if(!r.ok)throw 0;s=await r.json();if(!s||s.mode!=="PAPER_PLAY")throw 0}
    catch(e){const n=$("paper-note");n&&(n.textContent="paper ledger not published yet");return}
    const px=s.sol_usd,pnl=s.value_usd-s.start_usd;
    $("paper-start").textContent=usd(s.start_usd)+" ("+sol(s.start_sol)+")";
    const v=$("paper-value");v.textContent=usd(s.value_usd)+" \u00b7 "+sol(s.value_sol);v.className="m-v "+cls(pnl);
    const pv=$("paper-pnl");pv.textContent=(pnl>=0?"+":"")+usd(pnl);pv.className="m-v "+cls(pnl);
    const rz=$("paper-real");rz.textContent=usd(s.realized_usd)+" \u00b7 "+sol(s.realized_sol);rz.className="m-v "+cls(s.realized_usd);
    const ur=$("paper-unreal");ur.textContent=usd(s.unrealized_usd)+" \u00b7 "+sol(s.unrealized_sol);ur.className="m-v "+cls(s.unrealized_usd);
    $("paper-cash").textContent=sol(s.cash_sol)+" \u00b7 "+usd(s.cash_sol*px);
    $("paper-note").textContent="simulated, no real funds \u00b7 started "+pt(s.started_at)+" \u00b7 updated "+pt(s.updated_at);
    const op=$("paper-open");op.replaceChildren();
    if(!(s.open||[]).length)op.appendChild(row([Object.assign(td("No open paper positions."),{colSpan:5})]));
    for(const o of s.open||[])op.appendChild(row([td(o.ticker),td(pt(o.opened_at)),td(sol(o.remaining_basis_sol),"num"),td(o.value_usd==null?"\u2014":usd(o.value_usd),"num"),td(o.unreal_sol==null?"\u2014":usd(o.unreal_sol*px),"num "+cls(o.unreal_sol))]));
    const fl=$("paper-fills");fl.replaceChildren();
    const fills=(s.fills||[]).slice().reverse();
    if(!fills.length)fl.appendChild(row([Object.assign(td("No paper fills yet."),{colSpan:5})]));
    for(const f of fills){const p=f.pnl_sol_wallet;fl.appendChild(row([td(pt(f.ts_pt)),td(f.action),td(f.ticker),td(sol(Math.abs(f.sol_delta))+" \u00b7 "+usd(Math.abs(f.sol_delta)*px),"num"),td((f.rule||"")+(p!=null?" \u00b7 "+(p>=0?"+":"")+usd(p*px):""),p!=null?cls(p):"")]))}
  }
  load();setInterval(load,30000);
})();
