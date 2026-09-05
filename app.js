/* bootstrap: restore app + BOOK leftover USD (all-SOL) */
(function(){
  var u="https://cdn.jsdelivr.net/gh/sparkmediaai/coins-desk@0987bf590ae9cd1671c99276791a18f94887c28a/app.js";
  var x=new XMLHttpRequest();
  x.open("GET",u,false);
  x.send(null);
  if(x.status<200||x.status>=300) throw new Error("app bootstrap "+x.status);
  var t=x.responseText;
  t=t.replace("d=r&&s!=null?o+s:r&&i===0?o:null","d=s!=null?(r?o:0)+s:r?o:null");
  if(t.indexOf("d=s!=null?(r?o:0)+s:r?o:null")<0) throw new Error("app bootstrap patch miss");
  (0,eval)(t);
})();
