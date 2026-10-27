import { Bar, PriceProvider, Quote } from '../types.js';
import { isoDate, withRetry } from '../util.js';

/**
 * Yahoo Finance - NIEoficjalny endpoint (moze padac/limitowac). Zawsze uzywaj FallbackPriceProvider.
 */
export class YahooPriceProvider implements PriceProvider {
  public id = 'yahoo';
  private base = 'https://query1.finance.yahoo.com/v8/finance/chart/';

  public async getDailyBars(ticker: string, from: string, to: string): Promise<Bar[]> {
    const p1 = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000);
    const p2 = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000);
    const url = this.base + encodeURIComponent(ticker) + '?period1=' + p1 + '&period2=' + p2 + '&interval=1d';
    const json: any = await withRetry(async () => {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (omni-invest)' } });
      if (!res.ok) { throw new Error('Yahoo HTTP ' + res.status); }
      return await res.json();
    }, 2, 500);
    const r = json && json.chart && json.chart.result && json.chart.result[0];
    if (!r || !r.timestamp || !r.indicators || !r.indicators.quote || !r.indicators.quote[0]) { return []; }
    const ts: number[] = r.timestamp;
    const closes: Array<number | null> = r.indicators.quote[0].close || [];
    const out: Bar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c === null || c === undefined || !Number.isFinite(c)) { continue; }
      out.push({ date: isoDate(new Date(ts[i] * 1000)), close: c });
    }
    return out;
  }

  public async getQuote(ticker: string): Promise<Quote | null> {
    const to = isoDate(new Date());
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 10);
    const bars = await this.getDailyBars(ticker, isoDate(d), to);
    if (!bars.length) { return null; }
    const last = bars[bars.length - 1];
    return { ticker, date: last.date, close: last.close };
  }
}
