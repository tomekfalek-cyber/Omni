export interface RebalanceRow {
  ticker: string;
  value: number;
  currentWeight: number;
  targetWeight: number;
  delta: number;
  amount: number;
  action: 'Kup' | 'Sprzedaj' | 'Trzymaj';
}

export interface RebalanceResult { total: number; rows: RebalanceRow[]; notes: string[]; disclaimer: string }

export function runRebalance(holdings: Record<string, number>, targets: Record<string, number>): RebalanceResult {
  const cur: Record<string, number> = {};
  for (const k of Object.keys(holdings)) { const v = Number(holdings[k]); if (Number.isFinite(v) && v >= 0) { cur[k] = v; } }
  const total = Object.values(cur).reduce((s, x) => s + x, 0);
  if (!(total > 0)) { throw new Error('Suma wartosci portfela musi byc > 0'); }
  const tg: Record<string, number> = {};
  for (const k of Object.keys(targets)) { const v = Number(targets[k]); if (Number.isFinite(v) && v >= 0) { tg[k] = v; } }
  const tsum = Object.values(tg).reduce((s, x) => s + x, 0);
  const notes: string[] = [];
  if (tsum > 1.0001) { notes.push('Suma wag docelowych > 100% - znormalizowano.'); }
  const norm: Record<string, number> = {};
  for (const k of Object.keys(tg)) { norm[k] = tsum > 0 ? tg[k] / tsum : 0; }
  const all = Array.from(new Set([...Object.keys(cur), ...Object.keys(norm)]));
  const rows: RebalanceRow[] = all.map((t) => {
    const value = cur[t] || 0;
    const cw = value / total;
    const tw = norm[t] || 0;
    const delta = tw - cw;
    const amount = delta * total;
    const action: 'Kup' | 'Sprzedaj' | 'Trzymaj' = Math.abs(delta) < 0.005 ? 'Trzymaj' : (delta > 0 ? 'Kup' : 'Sprzedaj');
    return { ticker: t, value: Math.round(value * 100) / 100, currentWeight: Math.round(cw * 10000) / 10000, targetWeight: Math.round(tw * 10000) / 10000, delta: Math.round(delta * 10000) / 10000, amount: Math.round(amount * 100) / 100, action };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const buy = rows.filter((r) => r.action === 'Kup').reduce((s, r) => s + r.amount, 0);
  const sell = rows.filter((r) => r.action === 'Sprzedaj').reduce((s, r) => s + Math.abs(r.amount), 0);
  notes.push('Do dokupienia: ' + buy.toFixed(2) + ' | do sprzedania: ' + sell.toFixed(2) + ' (roznica wynika z zaokraglen).');
  notes.push('Prowizje i podatki moga zmienic oplacalnosc rebalansu - sprawdz u brokera.');
  return { total: Math.round(total * 100) / 100, rows, notes, disclaimer: 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.' };
}
