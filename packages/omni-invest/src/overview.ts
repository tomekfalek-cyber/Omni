import { Bar } from './types.js';
import { InvestService } from './service.js';
import { annVol, dailyReturns, daysAgo, mapLimit, round, stdev, todayIso } from './util.js';

export type AssetClass = 'metal' | 'stock' | 'crypto' | 'other';

export interface InstrumentDef {
  id: string; name: string; symbol: string | null; cls: AssetClass; note?: string;
}

export const INSTRUMENTS: InstrumentDef[] = [
  { id: 'gold', name: 'Zloto (GLD)', symbol: 'GLD', cls: 'metal', note: 'ETF na zloto - zastepstwo fizycznego kruszcu' },
  { id: 'silver', name: 'Srebro (SLV)', symbol: 'SLV', cls: 'metal', note: 'ETF na srebro' },
  { id: 'btc', name: 'Bitcoin', symbol: 'BTC-USD', cls: 'crypto' },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH-USD', cls: 'crypto' },
  { id: 'bnb', name: 'BNB', symbol: 'BNB-USD', cls: 'crypto' },
  { id: 'sol', name: 'Solana', symbol: 'SOL-USD', cls: 'crypto' },
  { id: 'xrp', name: 'XRP', symbol: 'XRP-USD', cls: 'crypto' },
  { id: 'aapl', name: 'Apple', symbol: 'AAPL', cls: 'stock' },
  { id: 'msft', name: 'Microsoft', symbol: 'MSFT', cls: 'stock' },
  { id: 'nvda', name: 'NVIDIA', symbol: 'NVDA', cls: 'stock' },
  { id: 'googl', name: 'Alphabet', symbol: 'GOOGL', cls: 'stock' },
  { id: 'jpm', name: 'JPMorgan', symbol: 'JPM', cls: 'stock' },
  { id: 'xom', name: 'Exxon Mobil', symbol: 'XOM', cls: 'stock' },
  { id: 'anthropic', name: 'Anthropic', symbol: null, cls: 'other', note: 'Spolka NIEpubliczna - brak tickera, nie da sie kupic na gieldzie. IPO zapowiadane, bez potwierdzonej daty.' },
];

export interface InstrumentMetrics {
  price: number | null;
  r1m: number | null;
  r3m: number | null;
  r12m: number | null;
  vol: number | null;
  maxDD: number | null;
  trend: 'up' | 'down' | null;
}

function retAt(closes: number[], n: number): number | null {
  if (closes.length < n + 1) { return null; }
  const a = closes[closes.length - 1 - n];
  const b = closes[closes.length - 1];
  if (!(a > 0)) { return null; }
  return b / a - 1;
}

export function metricsFromBars(bars: Bar[]): InstrumentMetrics {
  const closes = bars.map((b) => b.close).filter((x) => Number.isFinite(x));
  const empty: InstrumentMetrics = { price: null, r1m: null, r3m: null, r12m: null, vol: null, maxDD: null, trend: null };
  if (closes.length < 25) { return empty; }
  const last = closes[closes.length - 1];
  const window = closes.slice(-252);
  const rets = dailyReturns(window);
  let peak = window[0], maxDD = 0;
  for (const c of window) { if (c > peak) { peak = c; } const dd = peak > 0 ? c / peak - 1 : 0; if (dd < maxDD) { maxDD = dd; } }
  const sma = window.length >= 50 ? window.slice(-50).reduce((s, x) => s + x, 0) / Math.min(50, window.length) : null;
  return {
    price: round(last, 4),
    r1m: retAt(closes, 21),
    r3m: retAt(closes, 63),
    r12m: retAt(closes, 252),
    vol: rets.length > 30 ? round(annVol(rets), 4) : null,
    maxDD: round(maxDD, 4),
    trend: sma === null ? null : (last >= sma ? 'up' : 'down'),
  };
}

export interface OverviewRow extends InstrumentDef, InstrumentMetrics { score: number | null; rank: number | null }

export interface OverviewResult {
  asOf: string;
  rows: OverviewRow[];
  top: string[];
  notes: string[];
  disclaimer: string;
}

function zmap(vals: Array<number | null>): Array<number | null> {
  const ok = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (ok.length < 3) { return vals.map(() => null); }
  const m = ok.reduce((s, x) => s + x, 0) / ok.length;
  const sd = stdev(ok);
  if (sd <= 1e-12) { return vals.map((v) => (v === null ? null : 0)); }
  return vals.map((v) => (v === null ? null : (v - m) / sd));
}

export async function runOverview(service: InvestService): Promise<OverviewResult> {
  const from = daysAgo(420);
  const to = todayIso();
  const notes: string[] = [];
  const data = await mapLimit(INSTRUMENTS, 4, async (def) => {
    if (!def.symbol) { return { def, metrics: null as InstrumentMetrics | null }; }
    try {
      const bars = await service.price.getDailyBars(def.symbol, from, to);
      if (!bars.length) { notes.push('Brak danych: ' + def.name + ' (' + def.symbol + ')'); }
      return { def, metrics: bars.length ? metricsFromBars(bars) : null };
    } catch (e) {
      notes.push('Blad danych: ' + def.name);
      return { def, metrics: null as InstrumentMetrics | null };
    }
  });

  const mom = zmap(data.map((d) => (d.metrics && d.metrics.r12m !== null ? d.metrics.r12m : null)));
  const mid = zmap(data.map((d) => (d.metrics && d.metrics.r3m !== null ? d.metrics.r3m : null)));
  const volz = zmap(data.map((d) => (d.metrics && d.metrics.vol !== null ? -d.metrics.vol : null)));

  const rows: OverviewRow[] = data.map((d, i) => {
    const m = d.metrics || { price: null, r1m: null, r3m: null, r12m: null, vol: null, maxDD: null, trend: null };
    const parts: number[] = [];
    if (mom[i] !== null) { parts.push((mom[i] as number) * 0.5); }
    if (mid[i] !== null) { parts.push((mid[i] as number) * 0.3); }
    if (volz[i] !== null) { parts.push((volz[i] as number) * 0.2); }
    let score: number | null = parts.length ? parts.reduce((s, x) => s + x, 0) : null;
    if (score !== null && m.trend) { score += m.trend === 'up' ? 0.25 : -0.25; }
    return { ...d.def, ...m, score: score === null ? null : round(score, 3), rank: null };
  });

  const ranked = rows.filter((r) => r.score !== null).sort((a, b) => (b.score as number) - (a.score as number));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const top = ranked.slice(0, 3).map((r) => r.id);

  if (rows.some((r) => r.id === 'gold')) { notes.push('Zloto i srebro liczone przez ETF (GLD/SLV), nie przez cene kruszcu w skupie.'); }
  if (rows.some((r) => r.id === 'anthropic')) { notes.push('Anthropic nie jest notowana - nie ma mozliwosci zakupu akcji; to pozycja obserwowana.'); }
  notes.push('Dane: Yahoo Finance (fallback Stooq), moga byc opoznione. Cache odswiezany co ~10 min.');

  return { asOf: to, rows, top, notes, disclaimer: 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.' };
}
