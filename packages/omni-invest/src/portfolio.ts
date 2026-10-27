export type PortfolioAssetClass = 'equity' | 'gold' | 'crypto' | 'bonds';

export interface PortfolioHolding { name: string; value: number }
export interface HoldingMeta { cls: PortfolioAssetClass; us: number; tech: number; ccy: 'USD' | 'PLN'; label: string }
export interface PortfolioRow extends HoldingMeta {
  name: string; value: number; weight: number; target: number; delta: number; monthly: number;
}
export interface PortfolioResult {
  total: number;
  rows: PortfolioRow[];
  buckets: Record<PortfolioAssetClass, number>;
  usShare: number; techShare: number; usdShare: number;
  notes: string[];
  disclaimer: string;
}

function fold(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
}

export function classify(name: string): HoldingMeta {
  const n = fold(name);
  if (/btc|bitcoin/.test(n)) { return { cls: 'crypto', us: 0, tech: 0, ccy: 'USD', label: 'Bitcoin' }; }
  if (/sol|solana/.test(n)) { return { cls: 'crypto', us: 0, tech: 0, ccy: 'USD', label: 'Solana' }; }
  if (/zlot|gold|igln/.test(n)) { return { cls: 'gold', us: 0, tech: 0, ccy: 'USD', label: 'Zloto' }; }
  if (/obligac|bond|edo|coi|ros/.test(n)) { return { cls: 'bonds', us: 0, tech: 0, ccy: 'PLN', label: 'Obligacje PL' }; }
  if (/nasdaq|cndx/.test(n)) { return { cls: 'equity', us: 1, tech: 0.55, ccy: 'USD', label: 'Nasdaq 100' }; }
  if (/world|iwda|msci world/.test(n)) { return { cls: 'equity', us: 0.70, tech: 0.25, ccy: 'USD', label: 'MSCI World' }; }
  if (/s&p|sp ?500|cspx/.test(n)) { return { cls: 'equity', us: 1, tech: 0.32, ccy: 'USD', label: 'S&P 500' }; }
  return { cls: 'equity', us: 0.6, tech: 0.2, ccy: 'USD', label: String(name).trim() || 'Inne' };
}

export const DEFAULT_TARGETS: Record<string, number> = {
  'MSCI World': 35,
  'S&P 500': 25,
  'Nasdaq 100': 5,
  'Zloto': 10,
  'Obligacje PL': 20,
  'Bitcoin': 5,
  'Solana': 0,
};

export function runPortfolio(holdings: PortfolioHolding[], monthlyRaw?: number, targetsRaw?: Record<string, number>): PortfolioResult {
  const list = holdings.filter((h) => h && Number.isFinite(Number(h.value)) && Number(h.value) >= 0);
  const total = list.reduce((s, h) => s + Number(h.value), 0);
  if (!(total > 0)) { throw new Error('Suma wartosci portfela musi byc > 0'); }
  const monthly = Math.max(0, Number(monthlyRaw) || 0);
  const targets = Object.keys(targetsRaw || {}).length ? (targetsRaw as Record<string, number>) : DEFAULT_TARGETS;

  const merged: Record<string, { name: string; value: number; meta: HoldingMeta }> = {};
  for (const h of list) {
    const meta = classify(h.name);
    const key = meta.label;
    if (!merged[key]) { merged[key] = { name: h.name, value: 0, meta }; }
    merged[key].value += Number(h.value);
  }

  const keys = Object.keys(merged);
  const known = keys.filter((k) => targets[k] !== undefined);
  const unknown = keys.filter((k) => targets[k] === undefined);
  const notes: string[] = [];
  if (unknown.length) { notes.push('Instrumenty bez zdefiniowanego celu (nie wchodza do podzialu 600 zl): ' + unknown.join(', ')); }
  const targetSum = known.reduce((s, k) => s + (targets[k] || 0), 0);
  if (targetSum > 0 && Math.abs(targetSum - 100) > 0.5) { notes.push('Suma celow = ' + targetSum.toFixed(1) + '% - znormalizowano do 100%.'); }
  const norm = (k: string): number => targetSum > 0 ? (targets[k] || 0) / targetSum : 0;

  const rows: PortfolioRow[] = keys.map((k) => {
    const w = merged[k].value / total;
    const t = known.indexOf(k) >= 0 ? norm(k) : 0;
    return { ...merged[k].meta, name: merged[k].name, value: merged[k].value, weight: w, target: t, delta: t - w, monthly: 0 };
  }).sort((a, b) => b.weight - a.weight);

  const under = rows.filter((r) => r.target > r.weight + 0.005);
  const gap = under.reduce((s, r) => s + (r.target - r.weight), 0);
  if (monthly > 0 && gap > 0) {
    for (const r of rows) {
      r.monthly = r.target > r.weight + 0.005 ? monthly * ((r.target - r.weight) / gap) : 0;
    }
  }

  const sum = (filterFn: (r: PortfolioRow) => boolean, key: 'weight' | 'value'): number => rows.filter(filterFn).reduce((s, r) => s + (key === 'weight' ? r.weight : r.value), 0);
  const buckets: Record<PortfolioAssetClass, number> = {
    equity: sum((r) => r.cls === 'equity', 'weight'),
    gold: sum((r) => r.cls === 'gold', 'weight'),
    crypto: sum((r) => r.cls === 'crypto', 'weight'),
    bonds: sum((r) => r.cls === 'bonds', 'weight'),
  };
  const usShare = rows.reduce((s, r) => s + r.weight * r.us, 0);
  const techShare = rows.reduce((s, r) => s + r.weight * r.tech, 0);
  const usdShare = rows.reduce((s, r) => s + r.weight * (r.ccy === 'USD' ? 1 : 0), 0);

  if (buckets.crypto > 0.08) { notes.push('Krypto ' + (buckets.crypto * 100).toFixed(1) + '% - powyzej typowego limitu 5% dla portfela emerytalnego.'); }
  if (usShare > 0.5) { notes.push('Ekspozycja na USA ' + (usShare * 100).toFixed(0) + '% - wysoka koncentracja geograficzna.'); }
  if (techShare > 0.3) { notes.push('Sektor technologiczny ' + (techShare * 100).toFixed(0) + '% - wysoka koncentracja sektorowa.'); }
  notes.push('Udziały USA/tech/waluta to przybliżenie na podstawie typowego składu ETF (look-through).');

  return { total, rows, buckets, usShare, techShare, usdShare, notes, disclaimer: 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.' };
}

export function parseHoldings(s: string): PortfolioHolding[] {
  const out: PortfolioHolding[] = [];
  for (const part of String(s || '').split(/[;\n]+/)) {
    const m = part.split('=');
    if (m.length < 2) { continue; }
    const name = m[0].trim();
    const value = Number(m[1].replace(/[^0-9.,-]/g, '').replace(',', '.'));
    if (name && Number.isFinite(value)) { out.push({ name, value }); }
  }
  return out;
}
