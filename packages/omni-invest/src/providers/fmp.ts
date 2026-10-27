import { Fundamentals, FundamentalsProvider } from '../types.js';
import { toNum, withRetry } from '../util.js';

/**
 * FMP - wymaga klucza (FMP_API_KEY). Wersja defensywna: brak klucza = null.
 * UWAGA: endpointy FMP bywaja zmieniane; traktuj jako 'do weryfikacji' z wlasnym kluczem.
 */
export class FmpFundamentalsProvider implements FundamentalsProvider {
  public id = 'fmp';
  private key: string;
  constructor(key?: string) { this.key = String(key || process.env.FMP_API_KEY || '').trim(); }

  public hasKey(): boolean { return this.key.length > 0; }

  public async getFundamentals(ticker: string): Promise<Fundamentals | null> {
    if (!this.key) { return null; }
    const base = 'https://financialmodelingprep.com/api/v3';
    const q = (p: string) => base + p + '?apikey=' + encodeURIComponent(this.key);
    try {
      const [prof, rat] = await Promise.all([
        withRetry(async () => (await fetch(q('/profile/' + encodeURIComponent(ticker)))).json(), 2, 400),
        withRetry(async () => (await fetch(q('/ratios-ttm/' + encodeURIComponent(ticker)))).json(), 2, 400),
      ]);
      const p: any = Array.isArray(prof) ? prof[0] : null;
      const r: any = Array.isArray(rat) ? rat[0] : null;
      if (!p && !r) { return null; }
      return {
        ticker,
        asOf: new Date().toISOString().slice(0, 10),
        pe: toNum(r && r.peRatioTTM),
        pb: toNum(r && r.priceToBookRatioTTM),
        debtToEquity: toNum(r && r.debtEquityRatioTTM),
        grossMargin: toNum(r && r.grossProfitMarginTTM),
        roe: toNum(r && r.returnOnEquityTTM),
        fcfYield: toNum(r && r.freeCashFlowYieldTTM),
        evEbitda: null,
        sector: p && p.sector ? String(p.sector) : null,
      };
    } catch (e) { return null; }
  }
}
