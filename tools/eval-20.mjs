import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
function fold(s){
  const m = { 'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z' };
  return String(s).toLowerCase().replace(/[ąćęłńóśźż]/g, function(c){ return m[c] || c; });
}
function post(path, body, cookie){
  return new Promise(function(res, rej){
    const data = JSON.stringify(body);
    const req = http.request({ host:'127.0.0.1', port:7800, path:path, method:'POST', headers: Object.assign({ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) }, cookie?{Cookie:cookie}:{}) }, function(r){
      let b=''; r.on('data', function(c){ b+=c; }); r.on('end', function(){ res({ code:r.statusCode, headers:r.headers, body:b }); });
    });
    req.on('error', rej); req.write(data); req.end();
  });
}
const CASES = [
  { q: 'Ile to jest 17 razy 23?', kw: ['391'] },
  { q: 'Jaka jest dzisiaj data?', kw: ['2026'] },
  { q: 'Jaka jest stolica Polski?', kw: ['warszawa'] },
  { q: 'Ile znakow ma slowo abcdef?', kw: ['6'] },
  { q: 'Ile wynosi pierwiastek z 144?', kw: ['12'] },
  { q: 'Wymien trzy jezyki programowania.', kw: ['python','javascript','java','c++'] },
  { q: 'Co oznacza skrot HTTP?', kw: ['protokol','hypertext','transfer'] },
  { q: 'Ile wynosi 2 do potegi 10?', kw: ['1024'] },
  { q: 'Kto napisal Pana Tadeusza?', kw: ['mickiewicz'] },
  { q: 'W jakim kraju lezy Tokio?', kw: ['japoni'] },
  { q: 'Ile sekund ma godzina?', kw: ['3600'] },
  { q: 'Jaka jest najdluzsza rzeka w Polsce?', kw: ['wisla'] },
  { q: 'Odwroc slowo abcdef.', kw: ['fedcba'] },
  { q: 'Ile to 100 minus 58?', kw: ['42'] },
  { q: 'W ktorym roku wybuchla II wojna swiatowa?', kw: ['1939'] },
  { q: 'Wymien dwa owoce.', kw: ['jablko','banan','gruszka','pomarancz','truskawk'] },
  { q: 'Ile stopni ma kat prosty?', kw: ['90'] },
  { q: 'Jak nazywa sie najwieksza planeta Układu Slonecznego?', kw: ['jowisz'] },
  { q: 'Co to jest git commit?', kw: ['zapis','zmian','wersj'] },
  { q: 'Ile plikow .md jest w katalogu /home/openclaw?', kw: ['6','liczb','plik'] }
];
(async function(){
  const panelCode = process.env.OMNI_CODE || fs.readFileSync(os.homedir() + '/.omni/panel-code', 'utf8').trim();
  const lg = await post('/api/login', { code: panelCode });
  const ck = (lg.headers['set-cookie']||[]).map(function(s){ return s.split(';')[0]; }).join('; ');
  let ok = 0;
  for (let i=0;i<CASES.length;i++){
    const c = CASES[i];
    let status='?', res='';
    try {
      const r = await post('/api/tasks', { sessionId:'eval-'+i+'-'+Date.now(), prompt:c.q, clientId:'eval', cwd:'/home/openclaw' }, ck);
      const j = JSON.parse(r.body); status = j.status || '?'; res = String(j.result || '');
    } catch(e){ res = 'ERR '+e.message; }
    const low = fold(res);
    const hit = c.kw.some(function(k){ return low.indexOf(fold(k)) !== -1; });
    if (hit && status === 'completed') { ok++; }
    console.log((hit?'PASS':'FAIL')+' ['+status+'] '+c.q+' => '+res.slice(0,80).replace(/[\r\n]+/g,' '));
  }
  console.log('WYNIK_EVAL: '+ok+'/'+CASES.length);
})().catch(function(e){ console.log('ERR='+e.message); });