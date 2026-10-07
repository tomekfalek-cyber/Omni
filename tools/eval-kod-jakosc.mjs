import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import cp from 'node:child_process';

const DIR = '/tmp/omni_kodjakosc';
const CASE = "W katalogu /tmp/omni_kodjakosc napisz PRODUKCYJNY klient HTTP w Pythonie (biblioteka requests) do przykladowego API. Wymagania: (1) sekrety TYLKO z ENV, (2) pobieranie listy z PAGINACJA (limit/offset), (3) zmiana zasobu (PATCH) domyslnie w trybie DRY-RUN, (4) odswiezanie tokena na 401, (5) backoff na 429 i 5xx z Retry-After, (6) walidacja wejscia, (7) graceful shutdown (SIGINT), (8) testy unittest czystej logiki. Zapisz pliki .py do tego katalogu i URUCHOM testy (python3 -m unittest).";

function post(p, b, c) {
  return new Promise(function (res, rej) {
    const d = JSON.stringify(b);
    const r = http.request({ host: '127.0.0.1', port: 7800, path: p, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }, c ? { Cookie: c } : {}) }, function (x) { let s = ''; x.on('data', k => s += k); x.on('end', () => res({ code: x.statusCode, headers: x.headers, body: s })); });
    r.on('error', rej); r.write(d); r.end();
  });
}
function py(args) { return cp.spawnSync('python3', args, { cwd: DIR, encoding: 'utf8', timeout: 60000 }); }

(async function () {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const code = process.env.OMNI_CODE || fs.readFileSync(os.homedir() + '/.omni/panel-code', 'utf8').trim();
  const lg = await post('/api/login', { code });
  const ck = (lg.headers['set-cookie'] || []).map(s => s.split(';')[0]).join('; ');
  const t0 = Date.now(); let status = '?';
  try {
    const r = await post('/api/tasks', { sessionId: 'kodjak-' + Date.now(), prompt: CASE, clientId: 'kodjak', cwd: DIR }, ck);
    status = (JSON.parse(r.body).status) || '?';
  } catch (e) { status = 'ERR ' + e.message; }
  const secs = Math.round((Date.now() - t0) / 1000);
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.py'));
  let all = '';
  for (const f of files) { try { all += fs.readFileSync(DIR + '/' + f, 'utf8') + '\n'; } catch (e) {} }
  const low = all.toLowerCase();
  const uni = py(['-m', 'unittest', 'discover', '-v']);
  const uniTxt = String(uni.stdout || '') + String(uni.stderr || '');
  const nonTest = files.filter(f => !/^test_|_test\.py$/.test(f));
  const hardSecret = /(client_secret|api_key|password|token)\s*=\s*["'][^"']{6,}["']/i.test(all);
  const checks = [
    ['sekrety z ENV', /os\.environ|getenv/.test(all) && !hardSecret],
    ['paginacja (limit/offset/page)', /offset|limit|\bpage\b/i.test(all)],
    ['backoff 429/5xx (Retry-After)', /429|retry-after|backoff|Retry\(/i.test(all)],
    ['refresh tokena na 401', /401/.test(all)],
    ['brak golego except:', !/except\s*:/.test(all)],
    ['dry-run domyslny', /dry[_-]?run/i.test(all)],
    ['graceful shutdown (SIGINT)', /sigint|signal\.signal/i.test(all)],
    ['walidacja wejscia', /raise |ValueError|if not /i.test(all)],
    ['testy przechodza (unittest OK)', uni.status === 0 && /OK/.test(uniTxt)],
    ['docstring obecny', /"""/.test(all)],
    ['modularnosc (>=2 pliki .py lub >=3 def)', (nonTest.length >= 2 || (all.match(/\ndef /g) || []).length >= 3)],
  ];
  let pass = 0;
  for (const c of checks) { if (c[1]) pass++; console.log((c[1] ? 'PASS' : 'FAIL') + ' :: ' + c[0]); }
  console.log('PLIKI=' + files.join(',') + ' | STATUS=' + status + ' | czas=' + secs + 's');
  console.log('WYNIK_EVAL_KODJAKOSC: ' + pass + '/' + checks.length);
})().catch(e => console.log('ERR=' + e.message));