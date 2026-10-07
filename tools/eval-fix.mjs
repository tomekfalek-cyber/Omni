import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import cp from 'node:child_process';
import crypto from 'node:crypto';

const DIR = '/tmp/omni_fix';
const CALC = "def add(a, b):\n    return a + b\n\n\ndef div(a, b):\n    return a / b\n\n\ndef average(nums):\n    return sum(nums) / len(nums)\n";
const TEST = "import unittest\nimport calc\n\n\nclass TestCalc(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(calc.add(2, 3), 5)\n\n    def test_div(self):\n        self.assertEqual(calc.div(6, 3), 2)\n\n    def test_div_by_zero(self):\n        self.assertIsNone(calc.div(1, 0))\n\n    def test_average_empty(self):\n        self.assertIsNone(calc.average([]))\n\n\nif __name__ == '__main__':\n    unittest.main()\n";
const CASE = 'W katalogu /tmp/omni_fix testy w test_calc.py NIE przechodza. Przeczytaj test_calc.py, znajdz blad w calc.py i napraw kod tak, aby wszystkie testy przechodzily (python3 -m unittest). NIE zmieniaj pliku test_calc.py.';

function post(p, b, c) {
  return new Promise(function (res, rej) {
    const d = JSON.stringify(b);
    const r = http.request({ host: '127.0.0.1', port: 7800, path: p, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }, c ? { Cookie: c } : {}) }, function (x) { let s = ''; x.on('data', k => s += k); x.on('end', () => res({ code: x.statusCode, headers: x.headers, body: s })); });
    r.on('error', rej); r.write(d); r.end();
  });
}
function py(args) { return cp.spawnSync('python3', args, { cwd: DIR, encoding: 'utf8', timeout: 60000 }); }
function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

(async function () {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(DIR + '/calc.py', CALC);
  fs.writeFileSync(DIR + '/test_calc.py', TEST);
  const testHash0 = hash(TEST);
  const before = py(['-m', 'unittest', 'test_calc']);
  console.log('PRZED: testy ' + (before.status === 0 ? 'przechodza (zle - seed powinien padac)' : 'padaja (dobrze)'));
  const code = process.env.OMNI_CODE || fs.readFileSync(os.homedir() + '/.omni/panel-code', 'utf8').trim();
  const lg = await post('/api/login', { code });
  const ck = (lg.headers['set-cookie'] || []).map(s => s.split(';')[0]).join('; ');
  const checks = [];
  const t0 = Date.now(); let status = '?';
  try {
    const r = await post('/api/tasks', { sessionId: 'fix-' + Date.now(), prompt: CASE, clientId: 'fix', cwd: DIR }, ck);
    status = (JSON.parse(r.body).status) || '?';
  } catch (e) { status = 'ERR ' + e.message; }
  const secs = Math.round((Date.now() - t0) / 1000);
  checks.push(['calc.py istnieje', fs.existsSync(DIR + '/calc.py')]);
  checks.push(['testy NIE zmienione (anti-cheat)', fs.existsSync(DIR + '/test_calc.py') && hash(fs.readFileSync(DIR + '/test_calc.py', 'utf8')) === testHash0]);
  const uni = py(['-m', 'unittest', 'test_calc', '-v']);
  checks.push(['testy przechodza po naprawie (exit 0 + OK)', uni.status === 0 && /OK/.test(String(uni.stdout || '') + String(uni.stderr || ''))]);
  const fn = py(['-c', 'import calc; assert calc.add(2,3)==5; assert calc.div(6,3)==2; assert calc.div(1,0) is None; assert calc.average([]) is None; print("FNOK")']);
  checks.push(['funkcje poprawne (niezalezny test)', fn.status === 0 && /FNOK/.test(String(fn.stdout || ''))]);
  let pass = 0;
  for (const c of checks) { if (c[1]) pass++; console.log((c[1] ? 'PASS' : 'FAIL') + ' :: ' + c[0]); }
  console.log('STATUS=' + status + ' czas=' + secs + 's');
  console.log('WYNIK_EVAL_FIX: ' + pass + '/' + checks.length);
})().catch(e => console.log('ERR=' + e.message));