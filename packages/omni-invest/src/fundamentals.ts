import { AnnualPoint, EquityFundamentals } from './types.js';

export function annualSeries(concept: any): AnnualPoint[] {
  if (!concept || !concept.units) { return []; }
  // NAPRAWA: wybierz jednostke z NAJWIEKSZA liczba rekordow (czesc spolek ma klucz zbiorczy typu 'pure,USD/shares').
  const unitKeys = Object.keys(concept.units);
  let unitKey = unitKeys[0];
  let bestLen = -1;
  for (const k of unitKeys) { const v: any = (concept.units as any)[k]; const len = Array.isArray(v) ? v.length : Object.keys(v || {}).length; if (len > bestLen) { bestLen = len; unitKey = k; } }
  // NAPRAWA (2026-10-27): dla czesci spolek SEC zwraca units jako OBIEKT, nie tablice.
  // Wczesniej petla iterowala po kluczach i gubila wszystkie rekordy (KO, XOM, V, PEP).
  const rawUnits: any = concept.units[unitKey];
  const rows: any[] = Array.isArray(rawUnits) ? rawUnits : Object.keys(rawUnits || {}).map((k) => rawUnits[k]);
  const byEnd = new Map<string, { value: number; filed: string }>();
  for (const r of rows) {
    if (r.form !== '10-K' || r.fp !== 'FY') { continue; }
    if (!r.end || typeof r.val !== 'number') { continue; }
    // NAPRAWA (2026-10-27): pozycje bilansowe (kapital, zobowiazania, akcje) sa MOMENTOWE - bez 'start'.
    // Wczesniej byly odrzucane, przez co ROE/P/B/zadluzenie wychodzily jako brak danych.
    if (r.start) {
      const days = (new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000;
      if (days < 330 || days > 400) { continue; }
    }
    // NAPRAWA: przy wielu raportach dla tej samej daty bierzemy NAJSWIEZSZY (filed), nie ostatni w pliku.
    const prev = byEnd.get(String(r.end));
    const filed = String(r.filed || '');
    if (!prev || filed >= prev.filed) { byEnd.set(String(r.end), { value: r.val, filed }); }
  }
  return Array.from(byEnd.keys()).sort().map((end) => ({ end, year: Number(end.slice(0, 4)), value: (byEnd.get(end) as any).value })).slice(-6);
}

export interface Valuation {
  eps: number | null;
  revenue: number | null;
  equity: number | null;
  liabilities: number | null;
  netIncome: number | null;
  ocf: number | null;
  capex: number | null;
  shares: number | null;
  pe: number | null;
  pb: number | null;
  fcf: number | null;
  fcfYield: number | null;
  roe: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  revCagr3: number | null;
  epsCagr3: number | null;
  years: number;
}

function last(series: AnnualPoint[]): number | null {
  return series.length ? series[series.length - 1].value : null;
}

function cagr(series: AnnualPoint[], years: number): number | null {
  if (series.length < years + 1) { return null; }
  const a = series[series.length - 1 - years].value;
  const b = series[series.length - 1].value;
  if (!(a > 0) || !(b > 0)) { return null; }
  return Math.pow(b / a, 1 / years) - 1;
}

export function computeValuation(price: number | null, f: EquityFundamentals): Valuation {
  const eps = last(f.eps);
  const revenue = last(f.revenue);
  const equity = last(f.equity);
  const liabilities = last(f.liabilities);
  const netIncome = last(f.netIncome);
  const ocf = last(f.ocf);
  const capex = last(f.capex);
  const shares = last(f.shares);
  const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : (ocf !== null ? ocf : null);
  const mcap = price !== null && shares !== null ? price * shares : null;
  return {
    eps,
    revenue,
    equity,
    liabilities,
    netIncome,
    ocf,
    capex,
    shares,
    pe: price !== null && eps !== null && eps > 0 ? price / eps : null,
    pb: price !== null && equity !== null && shares !== null && shares > 0 && equity > 0 ? price / (equity / shares) : null,
    fcf,
    fcfYield: fcf !== null && mcap !== null && mcap > 0 ? fcf / mcap : null,
    roe: netIncome !== null && equity !== null && equity > 0 ? netIncome / equity : null,
    netMargin: netIncome !== null && revenue !== null && revenue > 0 ? netIncome / revenue : null,
    debtToEquity: liabilities !== null && equity !== null && equity > 0 ? liabilities / equity : null,
    revCagr3: cagr(f.revenue, 3),
    epsCagr3: cagr(f.eps, 3),
    years: f.eps.length,
  };
}
