import { UniverseDef } from './types.js';

export const UNIVERSES: UniverseDef[] = [
  { id: 'us-mega', name: 'US mega-cap (10)', currency: 'USD', tickers: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'JPM', 'XOM', 'JNJ', 'PG'] },
  { id: 'us-tech', name: 'US technology (8)', currency: 'USD', tickers: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE'] },
  { id: 'pl-wig20', name: 'PL WIG20 (10)', currency: 'PLN', tickers: ['PKN.WA', 'PKO.WA', 'PZU.WA', 'KGH.WA', 'DNP.WA', 'LPP.WA', 'CDR.WA', 'ALE.WA', 'MBK.WA', 'OPL.WA'] },
];

export function getUniverse(id: string): UniverseDef | null {
  const k = String(id || '').trim().toLowerCase();
  return UNIVERSES.find((u) => u.id === k) || null;
}
