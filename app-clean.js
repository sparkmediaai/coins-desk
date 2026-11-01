/* clean overlay: Holding = OPEN positions only, deduped by mint; closed = post-reset only, deduped; SOL-denominated P&L filled in as USD. Display only; never writes data. */
(function(){
  if(typeof renderAll!=="function")return;
  function t(x){var v=Date.parse(x||"");return isNaN(v)?null:v;}
  function isOpen(p){
    if(!p||!p.mint)return false;
    var st=String(p.status||"").toUpperCase(),act=String(p.action||"").toUpperCase();
    if(st!=="OPEN")return false;
    if(act&&act!=="BUY"&&act!=="FILL")return false;
    if(p.sold_usd!=null||p.sold_at||p.closed_at)return false;
    var tok=num(p.fill_token_amount)??num(p.tokens);return tok==null||tok>0;
  }
  function dedupe(list,key,stamp){var m=new Map();list.forEach(function(p){var k=key(p);var o=m.get(k);if(!o||(stamp(p)||0)>=(stamp(o)||0))m.set(k,p);});return Array.from(m.values());}
  function clean(f,solUsd){
    var desk=f.desk||{},reset=t(desk.start_reset_at);
    var pos=dedupe((Array.isArray(f.positions)?f.positions:[]).filter(isOpen),function(p){return p.mint;},function(p){return t(p.filled_at||p.ts_pt);});
    var closed=(Array.isArray(f.closed)?f.closed:[]).filter(function(c){
      if(!c||String(c.status||"").toUpperCase()!=="CLOSED")return false;
      var ct=t(c.closed_at||c.sold_at);if(ct==null)return false;
      return reset==null||ct>=reset;});
    closed=dedupe(closed,function(c){return c.exit_tx||c.tx||c.fill_tx||(c.mint+"|"+c.closed_at);},function(c){return t(c.closed_at);}).map(function(c){
      if(c.sold_usd!=null&&c.fill_usd!=null)return c;
      var x=Object.assign({},c),fs=num(c.fill_sol),ss=num(c.sold_sol),px=num(desk.sol_usd_at_reset)||solUsd;
      if(px&&fs!=null&&x.fill_usd==null)x.fill_usd=+(fs*px).toFixed(2);
      if(px&&ss!=null&&x.sold_usd==null)x.sold_usd=+(ss*px).toFixed(2);
      if(x.pnl_usd==null&&px&&num(c.pnl_sol)!=null)x.pnl_usd=+(num(c.pnl_sol)*px).toFixed(2);
      return x;});
    return Object.assign({},f,{positions:pos,closed:closed});
  }
  var _ra=renderAll;
  renderAll=function(f,q,s){_ra(clean(f,s),q,s);};
  if(typeof refresh==="function")refresh();
})();
