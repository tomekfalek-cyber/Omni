import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import cp from 'node:child_process';

const BASE = '/tmp/omni_trudne';
const PAGER = "def paginate(items, page, per_page):\n    \"\"\"Zwraca elementy dla danej strony (strony numerowane od 1).\"\"\"\n    start = page * per_page\n    return items[start:start + per_page]\n";
const TESTPAGER = "import unittest\nimport pager\n\n\nclass T(unittest.TestCase):\n    def test_first(self):\n        self.assertEqual(pager.paginate(list(range(10)), 1, 3), [0, 1, 2])\n\n    def test_second(self):\n        self.assertEqual(pager.paginate(list(range(10)), 2, 3), [3, 4, 5])\n\n    def test_last(self):\n        self.assertEqual(pager.paginate(list(range(10)), 4, 3), [9])\n\n\nif __name__ == '__main__':\n    unittest.main()\n";
const SALES = "region,amount\nnorth,100\nsouth,250\nnorth,50\neast,75\nsouth,25\n";

function post(p, b, c) {
  return new Promise(function (res, rej) {
    const d = JSON.stringify(b);
    const r = http.request({ host: '127.0.0.1', port: 7800, path: p, method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }, c ? { Cookie: c } : {}) }, function (x) { let s = ''; x.on('data', k => s += k); x.on('end', () => res({ code: x.statusCode, headers: x.headers, body: s })); });
    r.on('error', rej); r.write(d); r.end();
  });
}
function py(args, cwd) { return cp.spawnSync('python3', args, { cwd: cwd, encoding: 'utf8', timeout: 90000 }); }
function okPy(code, cwd) { const r = py(['-c', code], cwd); return r.status === 0; }

async function runTask(ck, prompt, cwd) {
  const r = await post('/api/tasks', { sessionId: 'trudne-' + Date.now() + '-' + Math.floor(Math.random() * 1000), prompt: prompt, clientId: 'trudne', cwd: cwd }, ck);
  try { return JSON.parse(r.body).status || '?'; } catch (e) { return 'ERR'; }
}

(async function () {
  const code = process.env.OMNI_CODE || fs.readFileSync(os.homedir() + '/.omni/panel-code', 'utf8').trim();
  const lg = await post('/api/login', { code });
  const ck = (lg.headers['set-cookie'] || []).map(s => s.split(';')[0]).join('; ');
  const results = [];

  // K1: napraw subtelny blad (off-by-one) - testow nie wolno zmieniac
  const d1 = BASE + '/k1'; fs.rmSync(d1, { recursive: true, force: true }); fs.mkdirSync(d1, { recursive: true });
  fs.writeFileSync(d1 + '/pager.py', PAGER); fs.writeFileSync(d1 + '/test_pager.py', TESTPAGER);
  const t1 = Date.now();
  const s1 = await runTask(ck, 'W katalogu ' + d1 + ' testy w test_pager.py NIE przechodza. Znajdz blad w pager.py i napraw kod tak, aby wszystkie testy przechodzily (python3 -m unittest). NIE zmieniaj pliku test_pager.py.', d1);
  const u1 = py(['-m', 'unittest', 'test_pager', '-v'], d1);
  const k1 = (u1.status === 0) && /OK/.test(String(u1.stdout || '') + String(u1.stderr || '')) && okPy('import pager; assert pager.paginate(list(range(10)),2,3)==[3,4,5]', d1);
  results.push(['K1 napraw off-by-one', k1, Math.round((Date.now() - t1) / 1000) + 's ' + s1]);

  // K2: pakiet wieloplikowy z zaleznoscia (mathx + statsx + testy)
  const d2 = BASE + '/k2'; fs.rmSync(d2, { recursive: true, force: true }); fs.mkdirSync(d2, { recursive: true });
  const t2 = Date.now();
  const s2 = await runTask(ck, 'W katalogu ' + d2 + ' stworz pakiet: mathx.py (funkcje add(a,b), mul(a,b)); statsx.py (mean(nums) i median(nums) - mean ma korzystac z mathx.add); oraz test_statsx.py z min. 3 testami unittest. Uruchom testy (python3 -m unittest) i upewnij sie, ze przechodza.', d2);
  const u2 = py(['-m', 'unittest', 'discover', '-v'], d2);
  const fun2 = okPy('import mathx, statsx; assert mathx.mul(3,4)==12; assert statsx.mean([1,2,3])==2; assert statsx.median([1,2,3])==2; assert statsx.median([1,2,3,4])==2.5', d2);
  const k2 = (u2.status === 0) && /OK/.test(String(u2.stdout || '') + String(u2.stderr || '')) && fun2;
  results.push(['K2 pakiet + zaleznosc', k2, Math.round((Date.now() - t2) / 1000) + 's ' + s2]);

  // K3: pipeline danych - policz sume dla regionu i zapisz wynik
  const d3 = BASE + '/k3'; fs.rmSync(d3, { recursive: true, force: true }); fs.mkdirSync(d3, { recursive: true });
  fs.writeFileSync(d3 + '/sales.csv', SALES);
  const t3 = Date.now();
  const s3 = await runTask(ck, 'W katalogu ' + d3 + ' jest plik sales.csv (kolumny: region,amount). Policz SUME kolumny amount dla wierszy z regionem north i zapisz wynik (tylko liczba, bez niczego wiecej) do pliku wynik.txt.', d3);
  let val = '';
  try { val = String(fs.readFileSync(d3 + '/wynik.txt', 'utf8')).trim(); } catch (e) { val = ''; }
  const k3 = /^150$/.test(val);
  results.push(['K3 pipeline danych (suma=150)', k3, Math.round((Date.now() - t3) / 1000) + 's ' + s3 + ' val=' + val]);

  let pass = 0;
  for (const r of results) { if (r[1]) pass++; console.log((r[1] ? 'PASS' : 'FAIL') + ' :: ' + r[0] + ' [' + r[2] + ']'); }
  console.log('WYNIK_EVAL_TRUDNE: ' + pass + '/' + results.length);
})().catch(e => console.log('ERR=' + e.message));