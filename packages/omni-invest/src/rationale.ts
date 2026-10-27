import { BacktestResult, ScreenResult, ScoredTicker, StrategyDef } from './types.js';
import { pct, round } from './util.js';

const DISCLAIMER = 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.';

export function explainPick(p: ScoredTicker, s: StrategyDef): string[] {
  const parts: string[] = [];
  for (const k of Object.keys(p.contributions)) {
    const w = p.contributions[k];
    if (Math.abs(w) < 0.0001) { continue; }
    parts.push(k + ' ' + (w > 0 ? '+' : '') + round(w, 2));
  }
  const lines: string[] = [];
  lines.push(p.rank + '. ' + p.ticker + ' - wynik ' + round(p.score, 2) + ' (' + (parts.join(', ') || 'brak wkladu') + ')');
  const m = p.metrics;
  const det: string[] = [];
  if (m.momentum != null) { det.push('momentum 12-1: ' + pct(Number(m.momentum))); }
  if (m.vol != null) { det.push('zmiennosc roczna: ' + pct(Number(m.vol))); }
  if (m.pe != null) { det.push('P/E: ' + round(Number(m.pe), 1)); }
  if (m.roe != null) { det.push('ROE: ' + pct(Number(m.roe))); }
  if (det.length) { lines.push('   ' + det.join(' | ')); }
  return lines;
}

export function renderScreen(r: ScreenResult): string {
  const nl = String.fromCharCode(10);
  const out: string[] = [];
  out.push('SCREENING: ' + r.strategyName + ' | uniwersum ' + r.universe + ' | stan na ' + r.asOf);
  out.push('');
  if (!r.picks.length) { out.push('Brak spolek spelniajacych kryteria.'); }
  const s: StrategyDef = { id: r.strategy, name: r.strategyName, description: '', weights: {}, topN: r.picks.length };
  for (const p of r.picks) { out.push(explainPick(p, s).join(nl)); }
  if (r.skipped) { out.push(''); out.push('Pominieto (za male pokrycie czynnikow): ' + r.skipped); }
  if (r.notes.length) { out.push(''); for (const n of r.notes) { out.push('UWAGA: ' + n); } }
  out.push('');
  out.push(DISCLAIMER);
  return out.join(nl);
}

export function renderBacktest(b: BacktestResult): string {
  const nl = String.fromCharCode(10);
  const out: string[] = [];
  out.push('BACKTEST: ' + b.strategy + ' | uniwersum ' + b.universe + ' | ' + b.from + ' → ' + b.to);
  out.push('Rebalansy: ' + b.rebalances + ' | koszt: ' + b.costBps + ' bps | obrot: ' + pct(b.turnover));
  out.push('CAGR: ' + pct(b.cagr) + ' | zmiennosc: ' + pct(b.vol) + ' | Sharpe: ' + b.sharpe);
  out.push('Max drawdown: ' + pct(b.maxDrawdown) + (b.benchmarkCagr === null ? '' : ' | benchmark (rowna waga): ' + pct(b.benchmarkCagr)));
  if (b.notes.length) { out.push(''); for (const n of b.notes) { out.push('UWAGA: ' + n); } }
  out.push('');
  out.push(DISCLAIMER);
  return out.join(nl);
}

export { DISCLAIMER };
