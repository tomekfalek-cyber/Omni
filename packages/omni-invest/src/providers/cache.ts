import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Bar, PriceProvider, Quote } from '../types.js';
import { daysAgo, todayIso } from '../util.js';

/** Cache dyskowy notowan - jeden plik na ticker, TTL w godzinach. */
export class CachedPriceProvider implements PriceProvider {
  public id: string;
  private inner: PriceProvider;
  private dir: string;
  private ttlMs: number;
  constructor(inner: PriceProvider, dir?: string, ttlHours = 20) {
    this.inner = inner;
    this.dir = dir || path.join(os.homedir(), '.omni', 'invest', 'cache');
    this.ttlMs = Math.max(1, ttlHours) * 3600 * 1000;
    this.id = 'cache(' + inner.id + ')';
  }
  private fileFor(ticker: string): string {
    return path.join(this.dir, String(ticker).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
  }
  public async getDailyBars(ticker: string, from: string, to: string): Promise<Bar[]> {
    const f = this.fileFor(ticker);
    try {
      const j: any = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j && j.at && (Date.now() - j.at) < this.ttlMs && Array.isArray(j.bars) && j.bars.length) {
        return (j.bars as Bar[]).filter((b) => b.date >= from && b.date <= to);
      }
    } catch (e) { }
    const bars = await this.inner.getDailyBars(ticker, from, to);
    if (bars.length) {
      try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ at: Date.now(), ticker, bars }), 'utf8'); } catch (e) { }
    }
    return bars;
  }
  public async getQuote(ticker: string): Promise<Quote | null> {
    const bars = await this.getDailyBars(ticker, daysAgo(10), todayIso());
    if (!bars.length) { return null; }
    const last = bars[bars.length - 1];
    return { ticker, date: last.date, close: last.close };
  }
}
