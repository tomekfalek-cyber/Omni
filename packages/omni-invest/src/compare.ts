import { InvestService } from './service.js';
import { Bar } from './types.js';
import { daysAgo, mapLimit, round, stdev, todayIso } from './util.js';

export interface CompareRow {
  ticker: string;
  price: number | null;
  ret: number | null;
  vol: number | null;
  maxDD: number | null;
  sharpe: number | null;
  beta: number | null;
  corr: number | null;
}

export interface CompareResult {
  asOf: string;
  from: string;
  days: number;
  rows: CompareRow[];
  notes: string[];
  disclaimer: string;
}

function stats(closes: number[]): { ret: number | null; vol: number | null; maxDD: number | null; sharpe: number | null } {
  if (closes.length < 30) { return { ret: null, vol: null, maxDD: null, sharpe: null }; }
  const ret = closes[closes.length - 1] / closes[0] - 1;
  let peak = closes[0], mdd = 0;
  const rs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const r = closes[i] / closes[i - 1] - 1;
    rs.push(r);
    if (closes[i] > peak) { peak = closes[i]; }
    const dd = peak > 0 ? closes[i] / peak - 1 : 0;
    if (dd < mdd) { mdd = dd; }
  }
  const mu = rs.reduce((s, x) => s + x, 0) / rs.length;
  const sd = stdev(rs);
  const vol = sd * Math.sqrt(252);
  return { ret, vol, maxDD: mdd, sharpe: vol > 0 ? (mu * 252) / vol : null };
}

export async function runCompare(service: InvestService, tickersRaw: string[], daysRaw?: number): Promise<CompareResult> {
  const tickers = tickersRaw.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8);
  if (tickers.length < 2) { throw new Error('Podaj co najmniej 2 instrumenty, np. NVDA,^NDX,GLD'); }
  const days = Math.max(60, Math.min(1900, Number(daysRaw) || 400));
  const from = daysAgo(days);
  const to = todayIso();
  const notes: string[] = [];

  const spy = await service.price.getDailyBars('SPY', from, to).catch(() => [] as Bar[]);
  const spyMap = new Map<string, number>();
  for (const b of spy) { spyMap.set(b.date, b.close); }

  const data = await mapLimit(tickers, 4, async (t) => {
    try { return { ticker: t, bars: await service.price.getDailyBars(t, from, to) }; }
    catch (e) { return { ticker: t, bars: [] as Bar[] }; }
  });
  for (const d of data) { if (!d.bars.length) { notes.push('Brak danych: ' + d.ticker); } }

  // Wspolne daty - uczciwe porownanie na tym samym okresie.
  const withData = data.filter((d) => d.bars.length);
  let common: string[] = [];
  if (withData.length >= 2) {
    const sets = withData.map((d) => new Map(d.bars.map((b) => [b.date, b.close])));
    const dates = Array.from(sets[0].keys()).sort();
    common = dates.filter((dt) => sets.every((m) => m.has(dt)));
  }
  if (common.length < 30) { notes.push('Za malo wspolnych dni notowan - porownanie liczone osobno dla kazdego instrumentu (moze byc mniej uczciwe).'); }

  const rows: CompareRow[] = data.map((d) => {
    const useCommon = common.length >= 30;
    const map = new Map(d.bars.map((b) => [b.date, b.close]));
    const dates = useCommon ? common : d.bars.map((b) => b.date);
    const closes = dates.map((dt) => map.get(dt)).filter((x): x is number => typeof x === 'number');
    const s = stats(closes);
    let beta: number | null = null, corr: number | null = null;
    if (spyMap.size > 60) {
      const rs: number[] = [], bs: number[] = [];
      for (let i = 1; i < dates.length; i++) {
        const a = map.get(dates[i - 1]), b2 = map.get(dates[i]);
        const sa = spyMap.get(dates[i - 1]), sb = spyMap.get(dates[i]);
        if (!a || !b2 || !sa || !sb || !(a > 0) || !(sa > 0)) { continue; }
        rs.push(b2 / a - 1); bs.push(sb / sa - 1);
      }
      if (rs.length > 30) {
        const mr = rs.reduce((x, y) => x + y, 0) / rs.length;
        const mb = bs.reduce((x, y) => x + y, 0) / bs.length;
        let cov = 0, varb = 0, vara = 0;
        for (let i = 0; i < rs.length; i++) { cov += (rs[i] - mr) * (bs[i] - mb); varb += (bs[i] - mb) * (bs[i] - mb); vara += (rs[i] - mr) * (rs[i] - mr); }
        if (varb > 0) { beta = cov / varb; }
        if (varb > 0 && vara > 0) { corr = cov / Math.sqrt(vara * varb); }
      }
    }
    return {
      ticker: d.ticker,
      price: closes.length ? round(closes[closes.length - 1], 4) : null,
      ret: s.ret === null ? null : round(s.ret, 4),
      vol: s.vol === null ? null : round(s.vol, 4),
      maxDD: s.maxDD === null ? null : round(s.maxDD, 4),
      sharpe: s.sharpe === null ? null : round(s.sharpe, 2),
      beta: beta === null ? null : round(beta, 2),
      corr: corr === null ? null : round(corr, 2),
    };
  });

  if (common.length >= 30) { notes.push('Porownanie na wspolnych dniach notowan: ' + common.length + ' dni (' + common[0] + ' - ' + common[common.length - 1] + ').'); }
  notes.push('Sharpe przy stopie wolnej od ryzyka 0%. Beta i korelacja wzgledem S&P 500 (SPY).');
  notes.push('Dane: Yahoo/Stooq, moga byc opoznione. Wyniki historyczne nie gwarantuja przyszlych.');

  return { asOf: to, from, days, rows, notes, disclaimer: 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.' };
}
