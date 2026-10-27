import { Bar, FactorId, Fundamentals, FundamentalsProvider, PriceProvider, ScreenResult, ScoredTicker, StrategyDef, UniverseDef } from './types.js';
import { FactorMatrixRow, computeMetrics, factorZscores } from './factors.js';
import { daysAgo, mapLimit, round, todayIso } from './util.js';

export interface ScreenOptions {
  strategy: StrategyDef;
  universe: UniverseDef;
  price: PriceProvider;
  fundamentals?: FundamentalsProvider | null;
  lookbackDays?: number;
  concurrency?: number;
}

export async function runScreen(opts: ScreenOptions): Promise<ScreenResult> {
  const notes: string[] = [];
  const factors = Object.keys(opts.strategy.weights) as FactorId[];
  const needFund = factors.some((f) => f === 'value' || f === 'quality');
  if (needFund && !opts.fundamentals) { notes.push('Brak dostawcy fundamentow - czynniki value/quality pominiete.'); }
  if (!opts.price) { throw new Error('Brak dostawcy cen'); }

  const from = daysAgo(opts.lookbackDays ?? 400);
  const to = todayIso();

  const data = await mapLimit(opts.universe.tickers, opts.concurrency ?? 4, async (t) => {
    let bars: Bar[] = [];
    try { bars = await opts.price.getDailyBars(t, from, to); } catch (e) { bars = []; }
    let f: Fundamentals | null = null;
    if (needFund && opts.fundamentals) { try { f = await opts.fundamentals.getFundamentals(t); } catch (e) { f = null; } }
    return { ticker: t, bars, f };
  });

  const rows: FactorMatrixRow[] = [];
  let missingBars = 0;
  for (const d of data) {
    if (!d.bars.length) { missingBars++; continue; }
    rows.push({ ticker: d.ticker, metrics: computeMetrics(d.bars, d.f), sector: d.f && d.f.sector ? d.f.sector : null });
  }
  if (missingBars) { notes.push('Brak danych cenowych dla ' + missingBars + ' spolek.'); }
  if (!rows.length) { throw new Error('Brak danych dla calego uniwersum'); }

  const z = factorZscores(rows, factors);
  const totalW = factors.reduce((s, f) => s + (opts.strategy.weights[f] || 0), 0) || 1;
  const scored: ScoredTicker[] = [];
  let skipped = 0;
  for (const row of rows) {
    let sum = 0, covered = 0;
    const contributions: Record<string, number> = {};
    for (const f of factors) {
      const w = opts.strategy.weights[f] || 0;
      const zz = z[row.ticker][f];
      if (zz === null || zz === undefined) { continue; }
      contributions[f] = round(zz * w, 4);
      sum += zz * w;
      covered += w;
    }
    const coverage = covered / totalW;
    if (coverage < (opts.strategy.minCoverage ?? 0.5)) { skipped++; continue; }
    scored.push({ ticker: row.ticker, score: round(sum / (covered || 1), 4), rank: 0, contributions, metrics: row.metrics });
  }
  scored.sort((a, b) => b.score - a.score);

  let picked = scored;
  const cap = opts.strategy.maxPerSector;
  if (cap) {
    const secOf = new Map<string, string | null>();
    for (const r of rows) { secOf.set(r.ticker, r.sector); }
    const used = new Map<string, number>();
    const out: ScoredTicker[] = [];
    for (const s of scored) {
      const sec = secOf.get(s.ticker) || null;
      if (sec) { const n = used.get(sec) || 0; if (n >= cap) { continue; } used.set(sec, n + 1); }
      out.push(s);
    }
    picked = out;
  }

  const top = picked.slice(0, opts.strategy.topN);
  top.forEach((s, i) => { s.rank = i + 1; });
  if (!top.length) { notes.push('Zadna spolka nie spelnila progu pokrycia czynnikow.'); }

  return {
    strategy: opts.strategy.id,
    strategyName: opts.strategy.name,
    universe: opts.universe.id,
    asOf: to,
    picks: top,
    skipped,
    notes,
  };
}
