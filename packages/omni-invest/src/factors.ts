import { Bar, FactorId, Fundamentals, TickerMetrics } from './types.js';
import { annVol, clampZ, dailyReturns, mean, momentum, zscores } from './util.js';

/** Surowa metryka pod dany czynnik (wyzej = lepiej po orientacji). */
export function rawForFactor(factor: FactorId, metrics: TickerMetrics): number | null {
  const v = metrics[factor === 'lowVol' ? 'vol' : factor];
  if (v === null || v === undefined || !Number.isFinite(v)) { return null; }
  if (factor === 'lowVol') { return -v; }
  return v;
}

export function computeMetrics(bars: Bar[], f: Fundamentals | null): TickerMetrics {
  const closes = bars.map((b) => b.close).filter((x) => Number.isFinite(x));
  const rets = dailyReturns(closes);
  const out: TickerMetrics = {
    momentum: momentum(closes, 21, 252),
    vol: rets.length > 30 ? annVol(rets) : null,
    pe: f && f.pe != null ? f.pe : null,
    pb: f && f.pb != null ? f.pb : null,
    roe: f && f.roe != null ? f.roe : null,
    grossMargin: f && f.grossMargin != null ? f.grossMargin : null,
    debtToEquity: f && f.debtToEquity != null ? f.debtToEquity : null,
    value: null,
    quality: null,
  };
  const vParts: number[] = [];
  if (f && f.pe != null && f.pe > 0) { vParts.push(1 / f.pe); }
  if (f && f.pb != null && f.pb > 0) { vParts.push(1 / f.pb); }
  if (f && f.fcfYield != null) { vParts.push(f.fcfYield); }
  if (f && f.evEbitda != null && f.evEbitda > 0) { vParts.push(1 / f.evEbitda); }
  out.value = vParts.length ? mean(vParts) : null;
  const qParts: number[] = [];
  if (f && f.roe != null) { qParts.push(f.roe); }
  if (f && f.grossMargin != null) { qParts.push(f.grossMargin); }
  if (f && f.debtToEquity != null) { qParts.push(-f.debtToEquity); }
  out.quality = qParts.length ? mean(qParts) : null;
  return out;
}

export interface FactorMatrixRow { ticker: string; metrics: TickerMetrics; sector: string | null }

/** Zamienia macierz metryk na z-score per czynnik (orientacja: wyzej = lepiej). */
export function factorZscores(rows: FactorMatrixRow[], factors: FactorId[]): Record<string, Record<string, number | null>> {
  const res: Record<string, Record<string, number | null>> = {};
  for (const row of rows) { res[row.ticker] = {}; }
  for (const factor of factors) {
    const raw = rows.map((r) => rawForFactor(factor, r.metrics));
    const z = zscores(raw);
    for (let i = 0; i < rows.length; i++) {
      const zi = z[i];
      res[rows[i].ticker][factor] = zi === null ? null : clampZ(zi);
    }
  }
  return res;
}
