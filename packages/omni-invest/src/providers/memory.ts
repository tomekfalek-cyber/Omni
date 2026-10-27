import { Bar, Fundamentals, FundamentalsProvider, PriceProvider, Quote } from '../types.js';

export class MemoryPriceProvider implements PriceProvider {
  public id = 'memory';
  private bars = new Map<string, Bar[]>();
  constructor(seed?: Record<string, Bar[]>) {
    if (seed) { for (const k of Object.keys(seed)) { this.bars.set(k, seed[k].slice()); } }
  }
  public setBars(ticker: string, bars: Bar[]): void { this.bars.set(ticker, bars.slice()); }
  public async getDailyBars(ticker: string, from: string, to: string): Promise<Bar[]> {
    const all = this.bars.get(ticker) || [];
    return all.filter((b) => b.date >= from && b.date <= to);
  }
  public async getQuote(ticker: string): Promise<Quote | null> {
    const all = this.bars.get(ticker) || [];
    if (!all.length) { return null; }
    const last = all[all.length - 1];
    return { ticker, date: last.date, close: last.close };
  }
}

export class MemoryFundamentalsProvider implements FundamentalsProvider {
  public id = 'memory';
  private data = new Map<string, Fundamentals>();
  constructor(seed?: Record<string, Fundamentals>) {
    if (seed) { for (const k of Object.keys(seed)) { this.data.set(k, seed[k]); } }
  }
  public set(ticker: string, f: Fundamentals): void { this.data.set(ticker, f); }
  public async getFundamentals(ticker: string): Promise<Fundamentals | null> {
    return this.data.get(ticker) || null;
  }
}
