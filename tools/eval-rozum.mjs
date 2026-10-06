import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
function fold(s){ const m={ 'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z' }; return String(s).toLowerCase().replace(/[ąćęłńóśźż]/g, c=>m[c]||c); }
function post(p,b,c){return new Promise(function(res,rej){const d=JSON.stringify(b);const r=http.request({host:'127.0.0.1',port:7800,path:p,method:'POST',headers:Object.assign({'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)},c?{Cookie:c}:{})},x=>{let s='';x.on('data',k=>s+=k);x.on('end',()=>res({code:x.statusCode,headers:x.headers,body:s}))});r.on('error',rej);r.write(d);r.end()})}
const REFUSE = /nie mam dostepu|brak narzedzi|nie moge tego zrobic|nie posiadam narzedzi/i;
const CASES = [
  { q: 'Ile to jest 17 razy 23 plus 5?', kw: ['396'], act: false },
  { q: 'Mam 3 jablka, dam 2 koledze i kupie 5. Ile bede mial?', kw: ['6'], act: false },
  { q: 'Jaka jest dzisiaj data?', kw: ['2026'], act: false },
  { q: 'Ogarnij katalog /tmp/omni_eval', kw: [], act: true },
  { q: 'Zrob porzadek w /tmp/omni_eval', kw: [], act: true },
  { q: 'Przygotuj liste plikow w /home/openclaw', kw: ['plik'], act: true },
  { q: 'Zajmij sie logami', kw: ['log'], act: true },
  { q: 'Sprawdz czy panel omni dziala', kw: ['200','dziala'], act: true },
  { q: 'Co jest nie tak z tym projektem?', kw: [], act: true },
  { q: 'Ktore procesy najbardziej obciazaja CPU?', kw: ['pid'], act: true },
];
(async function(){
  fs.mkdirSync('/tmp/omni_eval', { recursive: true });
  const code = process.env.OMNI_CODE || fs.readFileSync(os.homedir()+'/.omni/panel-code','utf8').trim();
  const lg = await post('/api/login', { code });
  const ck = (lg.headers['set-cookie']||[]).map(s=>s.split(';')[0]).join('; ');
  let ok = 0;
  for (let i=0;i<CASES.length;i++){ const c=CASES[i]; let st='?', res='';
    try { const r = await post('/api/tasks', { sessionId:'rozum-'+i+'-'+Date.now(), prompt:c.q, clientId:'rozum', cwd:'/tmp/omni_eval' }, ck); const j=JSON.parse(r.body); st=j.status||'?'; res=String(j.result||''); } catch(e){ res='ERR '+e.message; }
    const low = fold(res); const hit = c.kw.length===0 ? true : c.kw.some(k=>low.indexOf(fold(k))!==-1);
    const refused = REFUSE.test(low);
    const pass = (st==='completed') && hit && (!c.act || !refused);
    if (pass) ok++;
    console.log((pass?'PASS':'FAIL')+' ['+st+(refused?' ODMOWA':'')+'] '+c.q.slice(0,40));
  }
  console.log('WYNIK_EVAL_ROZUM: '+ok+'/'+CASES.length);
})().catch(e=>console.log('ERR='+e.message));