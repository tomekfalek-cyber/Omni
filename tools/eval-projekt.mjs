import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import cp from 'node:child_process';

const DIR = '/tmp/omni_proj';
const CASE = 'W katalogu /tmp/omni_proj stworz mini-biblioteke Python: plik textlib.py z funkcjami word_count(text)->int, reverse_words(text)->str, normalize(text)->str; oraz plik test_textlib.py z testami unittest (min 3 testy). Na koncu uruchom testy (python3 -m unittest) i upewnij sie, ze przechodza.';

function post(p, b, c) {
  return new Promise(function (res, rej) {
    const d = JSON.stringify(b);
    const r = http.request({ host: '127.0.0.1', port: 7800, path: p, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }, c ? { Cookie: c } : {}) }, function (x) { let s = ''; x.on('data', k => s += k); x.on('end', () => res({ code: x.statusCode, headers: x.headers, body: s })); });
    r.on('error', rej); r.write(d); r.end();
  });
}
function run(cmd, args, opts) {
  try { return { ok: true, out: String(cp.execFileSync(cmd, args, Object.assign({ timeout: 60000 }, opts || {}))) }; }
  catch (e) { return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) + ' [' + e.message + ']' }; }
}

(async function () {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const code = process.env.OMNI_CODE || fs.readFileSync(os.homedir() + '/.omni/panel-code', 'utf8').trim();
  const lg = await post('/api/login', { code });
  const ck = (lg.headers['set-cookie'] || []).map(s => s.split(';')[0]).join('; ');
  let pass = 0; const checks = [];
  const t0 = Date.now(); let status = '?', result = '';
  try {
    const r = await post('/api/tasks', { sessionId: 'projekt-' + Date.now(), prompt: CASE, clientId: 'projekt', cwd: DIR }, ck);
    const j = JSON.parse(r.body); status = j.status || '?'; result = String(j.result || '');
  } catch (e) { result = 'ERR ' + e.message; }
  const secs = Math.round((Date.now() - t0) / 1000);
  checks.push(['textlib.py istnieje', fs.existsSync(DIR + '/textlib.py')]);
  checks.push(['test_textlib.py istnieje', fs.existsSync(DIR + '/test_textlib.py')]);
  const uni = run('python3', ['-m', 'unittest', 'test_textlib', '-v'], { cwd: DIR });
  checks.push(['testy unittest przechodza (OK)', uni.ok && /OK/.test(uni.out)]);
  const fn = run('python3', ['-c', 'import textlib as t; assert t.word_count("a b c")==3; assert t.reverse_words("a b c")=="c b a"; assert "a" in t.normalize("A"); print("FNOK")'], { cwd: DIR });
  checks.push(['funkcje dzialaja niezaleznie', fn.ok && /FNOK/.test(fn.out)]);
  for (const c of checks) { if (c[1]) pass++; console.log((c[1] ? 'PASS' : 'FAIL') + ' :: ' + c[0]); }
  console.log('STATUS=' + status + ' czas=' + secs + 's engine=' + (result.length ? 'jest' : 'brak'));
  console.log('WYNIK_EVAL_PROJEKT: ' + pass + '/' + checks.length);
})().catch(e => console.log('ERR=' + e.message));