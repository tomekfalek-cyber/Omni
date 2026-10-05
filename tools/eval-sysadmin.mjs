import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
function fold(s){ const m={ 'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z' }; return String(s).toLowerCase().replace(/[ąćęłńóśźż]/g, function(c){ return m[c]||c; }); }
function post(path, body, cookie){ return new Promise(function(res, rej){ const data=JSON.stringify(body); const req=http.request({ host:'127.0.0.1', port:7800, path:path, method:'POST', headers: Object.assign({ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) }, cookie?{Cookie:cookie}:{}) }, function(r){ let b=''; r.on('data', function(c){ b+=c; }); r.on('end', function(){ res({ code:r.statusCode, headers:r.headers, body:b }); }); }); req.on('error', rej); req.write(data); req.end(); }); }
const CASES = [
  { q: 'Ktore procesy najbardziej obciazaja CPU? Podaj PID i nazwe.', kw: ['pid'] },
  { q: 'Jakie porty sa nasluchiwane na tej maszynie?', kw: ['7800'] },
  { q: 'Jaki proces slucha na porcie 7800?', kw: ['7800'] },
  { q: 'Sprawdz ostatnie linie logu /home/openclaw/omni/gateway.log.', kw: ['log','gateway','iterac','swarm'] },
  { q: 'Policz SHA-256 pliku /home/openclaw/.omni/config.json.', kw: ['sha','256'] },
  { q: 'Ile jest wolnej pamieci RAM na tej maszynie?', kw: ['mb','gb','pamiec','ram'] },
  { q: 'Ile miejsca jest wolne na dysku?', kw: ['gb','%','dysk','mount'] },
  { q: 'Sprawdz stan uslugi omni-gateway (systemd).', kw: ['active','aktywn','running','dziala'] },
  { q: 'Czy w logu sa bledy? Podaj ostatni jesli jest.', kw: ['blad','error','brak','nie ma','brak bledow'] },
  { q: 'Jaka jest wersja node.js na tej maszynie?', kw: ['v24','24.'] },
  { q: 'Sprawdz, czy panel Omni odpowiada — podaj kod HTTP.', kw: ['200'] },
  { q: 'Wymien procesy node dzialajace na tej maszynie.', kw: ['node'] }
];
(async function(){
  const panelCode = process.env.OMNI_CODE || fs.readFileSync(os.homedir() + '/.omni/panel-code', 'utf8').trim();
  const lg = await post('/api/login', { code: panelCode });
  const ck = (lg.headers['set-cookie']||[]).map(function(s){ return s.split(';')[0]; }).join('; ');
  let ok = 0; const results = [];
  for (let i=0;i<CASES.length;i++){
    const c = CASES[i]; let status='?', res='';
    try { const r = await post('/api/tasks', { sessionId:'syseval-'+i+'-'+Date.now(), prompt:c.q, clientId:'syseval', cwd:'/home/openclaw' }, ck); const j = JSON.parse(r.body); status = j.status||'?'; res = String(j.result||''); }
    catch(e){ res = 'ERR '+e.message; }
    const low = fold(res); const hit = c.kw.some(function(k){ return low.indexOf(fold(k)) !== -1; });
    if (hit && status === 'completed') { ok++; }
    console.log((hit?'PASS':'FAIL')+' ['+status+'] '+c.q+' => '+res.slice(0,70).replace(/[\r\n]+/g,' '));
  }
  console.log('WYNIK_EVAL_SYSADMIN: '+ok+'/'+CASES.length);
})().catch(function(e){ console.log('ERR='+e.message); });