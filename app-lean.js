/* lean overlay (redesign branch): compact closed history + summary + toggle; hide empty hunt/watch. Display only. */
(function(){
  if(typeof renderAll!=="function")return;
  function pnlOf(c){var f=num(c.fill_usd),s=num(c.sold_usd);if(f!=null&&s!=null)return s-f;return num(c.pnl_usd);}
  function ts(c){var t=Date.parse(c.closed_at||c.sold_at||c.filled_at||"");return isNaN(t)?-Infinity:t;}
  function fmtWhen(c){var t=ts(c);return t===-Infinity?"—":fmtFilledAt(c.closed_at||c.sold_at||c.filled_at);}
  function row(c){
    var tr=el("tr","cut"),td=el("td"),a=el("a","tk",c.ticker||"—");a.href=dexHref(c.mint);a.target="_blank";a.rel="noopener noreferrer";
    td.appendChild(a);if(c.close_reason)td.appendChild(el("span","why"," "+String(c.close_reason).toLowerCase().replace(/_/g," ")));tr.appendChild(td);
    tr.appendChild(el("td","when",fmtWhen(c)));
    tr.appendChild(tdNum(fmtUsd(num(c.fill_usd))));tr.appendChild(tdNum(fmtUsd(num(c.sold_usd))));
    var p=signedUsd(pnlOf(c));tr.appendChild(tdNum(p.text,p.cls));return tr;
  }
  renderClosed=function(list){
    var top=$("closed"),more=$("closed-more"),btn=$("closed-toggle"),sum=$("closed-summary");if(!top)return;
    var all=(list||[]).slice().sort(function(a,b){return ts(b)-ts(a);});
    top.replaceChildren();more.replaceChildren();
    if(!all.length){var r=el("tr","muted-row"),d=el("td",null,"No closed trades.");d.colSpan=5;r.appendChild(d);top.appendChild(r);btn.hidden=true;sum.textContent="";return;}
    all.slice(0,5).forEach(function(c){top.appendChild(row(c));});
    all.slice(5).forEach(function(c){more.appendChild(row(c));});
    var tot=0,w=0,l=0,known=0;all.forEach(function(c){var p=pnlOf(c);if(p==null)return;known++;tot+=p;p>0?w++:p<0&&l++;});
    var t=signedUsd(tot);sum.replaceChildren();
    sum.appendChild(document.createTextNode(all.length+" closed · realized "));sum.appendChild(el("b",t.cls,t.text));
    sum.appendChild(document.createTextNode(" · "+w+"W / "+l+"L"+(known<all.length?" ("+(all.length-known)+" without P&L)":"")));
    btn.hidden=all.length<=5;
    if(!btn.dataset.bound){btn.dataset.bound=1;btn.addEventListener("click",function(){var open=more.hidden;more.hidden=!open;btn.setAttribute("aria-expanded",String(open));btn.textContent=open?"Show latest 5":"Show all closed";});}
  };
  var _ra=renderAll;
  renderAll=function(f,q,s){_ra(f,q,s);
    var hp=$("hunt-panel"),wp=$("watch-panel");
    if(hp)hp.hidden=!(f.hunt&&f.hunt.length);if(wp)wp.hidden=!(f.watch&&f.watch.length);};
  if(typeof refresh==="function")refresh();
})();
