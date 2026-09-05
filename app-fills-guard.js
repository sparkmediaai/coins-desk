/* fills tip guard overlay */
(function(){
  var KEY="coins-desk-fills-v1";
  var _load=typeof loadFills==="function"?loadFills:null;
  if(!_load)return;
  function stub(t){t=String(t||"").trim();return!t||(/PLA/.test(t)&&/CEHOLDER/i.test(t))||/^LOAD_FROM:/i.test(t)||(t[0]!=="{"&&t[0]!=="[");}
  function ok(o){return o&&typeof o==="object"&&o.desk&&typeof o.desk==="object";}
  loadFills=async function(){
    var res=await fetch(FILLS_URL,{cache:"no-store"});
    if(!res.ok)throw new Error("fills "+res.status);
    var text=await res.text();
    if(stub(text)){var e=new Error("fills stub tip");e.code="STUB";throw e;}
    var data;try{data=JSON.parse(text);}catch(err){var e2=new Error("fills bad json");e2.code="BAD_JSON";throw e2;}
    if(!ok(data)){var e3=new Error("fills missing desk");e3.code="SHAPE";throw e3;}
    try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){}
    return data;
  };
  var _refresh=refresh;
  refresh=async function(){
    try{fills=await loadFills();}catch(err){
      var cached=null;try{var raw=localStorage.getItem(KEY);cached=raw?JSON.parse(raw):null;}catch(e){}
      if(cached&&ok(cached)){fills=cached;setStatus("stale","CACHED");var n=$("last-update");n&&(n.textContent="tip bad — showing last good");}
      else{setStatus("error","ERROR");var s=$("last-update");s&&(s.textContent="fills.json failed");return;}
    }
    return _refresh();
  };
  if(typeof refresh==="function")refresh();
})();
