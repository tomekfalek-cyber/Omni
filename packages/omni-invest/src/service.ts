import { FundamentalsProvider, PriceProvider, Quote } from './types.js';
import { YahooPriceProvider } from './providers/yahoo.js';
import { StooqPriceProvider } from './providers/stooq.js';
import { CachedPriceProvider } from './providers/cache.js';
import { FmpFundamentalsProvider } from './providers/fmp.js';
import { runScreen } from './screener.js';
import { runBacktest } from './backtest.js';
import { getStrategy } from './strategies.js';
import { getUniverse } from './universe.js';
import { SnapshotStore } from './store.js';
import { renderBacktest, renderScreen } from './rationale.js';

export class FallbackPriceProvider implements PriceProvider {
  public id = 'fallback';
  private providers: PriceProvider[];
  constructor(providers: PriceProvider[]) { this.providers = providers; }
  public async getDailyBars(ticker: string, from: string, to: string) {
    for (const p of this.providers) {
      try { const b = await p.getDailyBars(ticker, from, to); if (b.length) { return b; } } catch (e) { }
    }
    return [];
  }
  public async getQuote(ticker: string): Promise<Quote | null> {
    for (const p of this.providers) {
      try { const q = await p.getQuote(ticker); if (q) { return q; } } catch (e) { }
    }
    return null;
  }
}

export interface InvestServiceOptions {
  price?: PriceProvider;
  fundamentals?: FundamentalsProvider | null;
  store?: SnapshotStore;
}

export class InvestService {
  public price: PriceProvider;
  public fundamentals: FundamentalsProvider | null;
  public store: SnapshotStore;
  constructor(opts: InvestServiceOptions = {}) {
    this.price = opts.price || new CachedPriceProvider(new FallbackPriceProvider([new YahooPriceProvider(), new StooqPriceProvider()]));
    // FMP domyslnie: bez klucza zwraca null (strategie fundamentalne same sie wylacza), z kluczem - dziala.
    this.fundamentals = opts.fundamentals === undefined ? new FmpFundamentalsProvider() : opts.fundamentals;
    this.store = opts.store || new SnapshotStore();
  }

  public async screen(strategyId: string, universeId: string): Promise<{ text: string; result: any }> {
    const strategy = getStrategy(strategyId);
    if (!strategy) { throw new Error('Nieznana strategia: ' + strategyId); }
    const universe = getUniverse(universeId);
    if (!universe) { throw new Error('Nieznane uniwersum: ' + universeId); }
    const result = await runScreen({ strategy, universe, price: this.price, fundamentals: this.fundamentals });
    try { this.store.save({ at: result.asOf, strategy: result.strategy, universe: result.universe, picks: result.picks }); } catch (e) { }
    return { text: renderScreen(result), result };
  }

  public async backtest(strategyId: string, universeId: string, months?: number): Promise<{ text: string; result: any }> {
    const strategy = getStrategy(strategyId);
    if (!strategy) { throw new Error('Nieznana strategia: ' + strategyId); }
    const universe = getUniverse(universeId);
    if (!universe) { throw new Error('Nieznane uniwersum: ' + universeId); }
    const result = await runBacktest({ strategy, universe, price: this.price, months });
    return { text: renderBacktest(result), result };
  }

  public async quote(ticker: string): Promise<string> {
    const q = await this.price.getQuote(ticker);
    if (!q) { return 'Brak notowania dla ' + ticker; }
    return ticker + ': ' + q.close + ' (' + q.date + ')';
  }

  public lastSnapshot(): string {
    const s = this.store.last();
    if (!s) { return 'Brak zapisanych migawek.'; }
    const nl = String.fromCharCode(10);
    return ['Ostatnia migawka: ' + s.id + ' (' + s.at + ')', 'Strategia: ' + s.strategy + ' | uniwersum: ' + s.universe, 'Spolki: ' + s.picks.map((p) => p.ticker).join(', ')].join(nl);
  }
}
