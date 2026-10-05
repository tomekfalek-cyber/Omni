import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(execFile);
function post(p, body, cookie){ return new Promise(function(res, rej){ const data=JSON.stringify(body); const req=http.request({ host:'127.0.0.1', port:7800, path:p, method:'POST', headers: Object.assign({ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) }, cookie?{Cookie:cookie}:{}) }, function(r){ let b=''; r.on('data', c=>b+=c); r.on('end', ()=>res({ code:r.statusCode, headers:r.headers, body:b })); }); req.on('error', rej); req.write(data); req.end(); }); }
const CASES = [
  { name: 'is_prime', prompt: "Napisz w Pythonie funkcje is_prime(n) w <dir>/prime.py oraz testy w <dir>/test_prime.py (unittest), uruchom testy." },
  { name: 'factorial', prompt: "Napisz w Pythonie funkcje factorial(n) w <dir>/fact.py oraz testy w <dir>/test_fact.py (unittest), uruchom testy." },
  { name: 'reverse', prompt: "Napisz w Pythonie funkcje reverse(s) odwracajaca napis w <dir>/rev.py oraz testy w <dir>/test_rev.py (unittest), uruchom testy." },
  { name: 'div_safe', prompt: "Napisz w Pythonie funkcje div(a,b) z obsluga dzielenia przez zero (ValueError) w <dir>/divmod.py oraz testy w <dir>/test_divmod.py (unittest), uruchom testy." },
  { name: 'fib', prompt: "Napisz w Pythonie funkcje fib(n) (n-ta liczba Fibonacciego) w <dir>/fib.py oraz testy w <dir>/test_fib.py (unittest), uruchom testy." },
  { name: 'word_count', prompt: "Napisz w Pythonie funkcje word_count(text) zwracajaca slownik slow w <dir>/wc.py oraz testy w <dir>/test_wc.py (unittest), uruchom testy." },
  { name: 'max_list', prompt: "Napisz w Pythonie funkcje max_of(lista) zwracajaca najwiekszy element w <dir>/mx.py oraz testy w <dir>/test_mx.py (unittest), uruchom testy." },
  { name: 'even', prompt: "Napisz w Pythonie funkcje is_even(n) w <dir>/even.py oraz testy w <dir>/test_even.py (unittest), uruchom testy." },
];
(async function(){
  const code = process.env.OMNI_CODE || fs.readFileSync(os.homedir()+'/.omni/panel-code','utf8').trim();
  const lg = await post('/api/login', { code });
  const ck = (lg.headers['set-cookie']||[]).map(s=>s.split(';')[0]).join('; ');
  let ok = 0;
  for (let i=0;i<CASES.length;i++){
    const c = CASES[i];
    const dir = '/tmp/omni_evalkoder/' + c.name;
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const prompt = c.prompt.split('<dir>').join(dir);
    let status='?';
    try { const r = await post('/api/tasks', { sessionId: 'evalk-'+i+'-'+Date.now(), prompt, clientId:'evalk', cwd: dir }, ck); try { status = JSON.parse(r.body).status; } catch(e){} } catch(e){ status='ERR'; }
    let pass = false, note = '';
    try { const r = await pexec('python3', ['-m','unittest','discover','-s','.','-p','test_*.py'], { cwd: dir, timeout: 40000 }); pass = /OK/.test((r.stdout||'')+(r.stderr||'')); note = ((r.stderr||r.stdout||'').trim().split(String.fromCharCode(10)).slice(-1)[0]||'').slice(0,50); }
    catch(e){ pass = false; note = String((e.stdout||e.message||'')).split(String.fromCharCode(10)).slice(-1)[0].slice(0,50); }
    if (pass) ok++;
    console.log((pass?'PASS':'FAIL')+' ['+status+'] '+c.name+' :: '+note);
  }
  console.log('WYNIK_EVAL_KODER: '+ok+'/'+CASES.length);
})().catch(e=>console.log('ERR='+e.message));