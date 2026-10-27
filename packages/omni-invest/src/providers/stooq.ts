import { Bar, PriceProvider, Quote } from '../types.js';
import { withRetry } from '../util.js';

/**
 * Stooq - darmowe CSV. Ticker: 'PKN.WA' -> 'pkn' (GPW), 'AAPL' -> 'aapl.us'.
 */
export class StooqPriceProvider implements PriceProvider {
  public id = 'stooq';

  private map(ticker: string): string {
    const t = String(ticker || '').trim();
    if (/\.WA$/i.test(t)) { return t.replace(/\.WA$/i, '').toLowerCase(); }
    if (t.indexOf('.') === -1) { return t.toLowerCase() + '.us'; }
    return t.toLowerCase();
  }

  public async getDailyBars(ticker: string, from: string, to: string): Promise<Bar[]> {
    const sym = this.map(ticker);
    const d1 = from.replace(/-/g, ''), d2 = to.replace(/-/g, '');
    const url = 'https://stooq.com/q/d/l/?s=' + encodeURIComponent(sym) + '&d1=' + d1 + '&d2=' + d2 + '&i=d';
    const txt = await withRetry(async () => {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (omni-invest)' } });
      if (!res.ok) { throw new Error('Stooq HTTP ' + res.status); }
      return await res.text();
    }, 2, 400);
    const lines = String(txt).trim().split(/\r?\n/);
    if (lines.length < 2 || /^date,/i.test(lines[0]) === false) { return []; }
    const out: Bar[] = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length < 5) { continue; }
      const close = Number(c[4]);
      if (!Number.isFinite(close)) { continue; }
      out.push({ date: c[0], close });
    }
    return out;
  }

  public async getQuote(ticker: string): Promise<Quote | null> {
    const d = new Date(); const to = d.toISOString().slice(0, 10);
    const f = new Date(d.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const bars = await this.getDailyBars(ticker, f, to);
    if (!bars.length) { return null; }
    const last = bars[bars.length - 1];
    return { ticker, date: last.date, close: last.close };
  }
}
