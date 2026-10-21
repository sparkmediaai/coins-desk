/* light-blue redesign: number tick-up + card fade-in. Display only; no data logic. */
(function(){
  var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var RX=/^([+\u2212-]?)(\$?)([\d,]*\.?\d+)/;
  function parse(t){var m=String(t).match(RX);if(!m)return null;var v=parseFloat(m[3].replace(/,/g,""));return m[1]==="-"||m[1]==="\u2212"?-v:v;}
  function tick(id,startZero){
    var node=document.getElementById(id);if(!node||reduce)return;
    var last=startZero?0:null,mine=new Set(),raf=0;
    new MutationObserver(function(){
      var txt=node.textContent;
      if(mine.has(txt)){mine.delete(txt);return;}
      var v=parse(txt);if(v==null||last==null||v===last){last=v;return;}
      var m=txt.match(RX),sign=m[1],cur=m[2],dec=(m[3].split(".")[1]||"").length,tail=txt.slice(m[0].length);
      var from=last,to=v,t0=performance.now();last=v;cancelAnimationFrame(raf);node.classList.add("ticking");
      function write(s){mine.add(s);node.textContent=s;}
      (function step(now){var p=Math.min(1,(now-t0)/900),x=from+(to-from)*(1-Math.pow(1-p,3));
        if(p<1){var sg=x<0?(sign||"-"):(sign==="+"?"+":"");write(sg+cur+Math.abs(x).toFixed(dec)+tail);raf=requestAnimationFrame(step);}
        else{write(txt);node.classList.remove("ticking");}})(t0);
    }).observe(node,{childList:true,characterData:true,subtree:true});
  }
  tick("book-num",true);tick("vs-start");tick("vs-fill");
  if(!reduce&&"IntersectionObserver" in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target);}});},{threshold:.05});
    document.querySelectorAll(".mast,.book,.panel,.gate,.radar").forEach(function(n,i){n.classList.add("reveal");n.style.transitionDelay=Math.min(i*70,420)+"ms";io.observe(n);});
  }
})();
