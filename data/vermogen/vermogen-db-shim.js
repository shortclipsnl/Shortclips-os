/* Vervangt window.claude.use("db") uit claude.ai door een eigen opslag via de Shortclips OS-API.
   De pagina blijft ongewijzigd: zelfde paden (v/cfg, v/cfg/saldi/<id>, ...), zelfde functies.
   API (alleen voor de eigenaar, sessie-cookie):
     GET    /api/vermogen/docs              -> {"<pad>": {...document...}, ...}
     PUT    /api/vermogen/doc?path=<pad>    body = document (JSON) -> {ok:true}
     DELETE /api/vermogen/doc?path=<pad>    -> {ok:true}                                   */
(function(){
  const API="/api/vermogen";const store=new Map();const L=new Set();let ready=null;
  const notify=()=>L.forEach(f=>{try{f()}catch(e){console.error(e)}});
  const load=()=>ready||(ready=fetch(API+"/docs",{credentials:"same-origin"}).then(r=>{if(!r.ok)throw Object.assign(new Error("laden mislukt"),{code:r.status});return r.json()}).then(o=>{for(const [k,v] of Object.entries(o))store.set(k,v)}));
  const put=async(p,d)=>{const r=await fetch(API+"/doc?path="+encodeURIComponent(p),{method:"PUT",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(d)});if(!r.ok)throw Object.assign(new Error("opslaan mislukt"),{code:r.status});store.set(p,d);notify()};
  const del=async p=>{const r=await fetch(API+"/doc?path="+encodeURIComponent(p),{method:"DELETE",credentials:"same-origin"});if(!r.ok)throw Object.assign(new Error("verwijderen mislukt"),{code:r.status});store.delete(p);notify()};
  const snap=p=>({id:p.split("/").pop(),exists:store.has(p),data:()=>store.get(p),metadata:{}});
  const docRef=p=>({id:p.split("/").pop(),path:p,get:async()=>{await load();return snap(p)},
    set:d=>put(p,JSON.parse(JSON.stringify(d))),update:d=>put(p,{...(store.get(p)||{}),...d}),delete:()=>del(p),
    onSnapshot:(f,err)=>{const g=()=>f(snap(p));load().then(()=>{L.add(g);g()},e=>err&&err(e));return()=>L.delete(g)},
    collection:n=>colRef(p+"/"+n)});
  const colRef=c=>({path:c,doc:id=>docRef(c+"/"+(id||Math.random().toString(36).slice(2))),
    onSnapshot:(f,err)=>{const g=()=>{const docs=[...store.keys()].filter(k=>k.startsWith(c+"/")&&!k.slice(c.length+1).includes("/")).map(snap);f({docs,size:docs.length,empty:!docs.length})};load().then(()=>{L.add(g);g()},e=>err&&err(e));return()=>L.delete(g)}});
  window.claude=window.claude||{};const prev=window.claude.use;
  window.claude.use=async n=>n==="db"?{doc:docRef,collection:colRef}:(prev?prev(n):null);
})();
