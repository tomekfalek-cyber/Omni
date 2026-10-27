import { UniverseDef } from './types.js';
import { SP500 } from './sp500.js';

// UWAGA: mWIG40 - lista PRZYBLIZONA (sklad indeksu zmienia sie kwartalnie).
// Brakujace/nienotowane tickery sa automatycznie pomijane przez screener.
export const MWIG40: string[] = [
  '11B.WA', 'ABE.WA', 'ACP.WA', 'ALE.WA', 'ATT.WA', 'BHW.WA', 'BFT.WA', 'CCC.WA', 'CIG.WA', 'CLN.WA',
  'CPL.WA', 'DAT.WA', 'ENA.WA', 'ENT.WA', 'EUR.WA', 'FRO.WA', 'GPP.WA', 'GPW.WA', 'HUG.WA', 'ING.WA',
  'KRU.WA', 'KTY.WA', 'MAG.WA', 'MBK.WA', 'MOC.WA', 'NEU.WA', 'OPN.WA', 'PEO.WA', 'PGE.WA', 'PGN.WA',
  'PLW.WA', 'RBW.WA', 'SNT.WA', 'SPL.WA', 'TEN.WA', 'TPE.WA', 'VGO.WA', 'VOX.WA', 'WPL.WA', 'XTB.WA',
];

export const UNIVERSES: UniverseDef[] = [
  { id: 'us-mega', name: 'US mega-cap (10)', currency: 'USD', tickers: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'JPM', 'XOM', 'JNJ', 'PG'] },
  { id: 'us-tech', name: 'US technology (8)', currency: 'USD', tickers: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE'] },
  { id: 'sp500', name: 'S&P 500 (' + SP500.length + ')', currency: 'USD', tickers: SP500 },
  { id: 'pl-wig20', name: 'PL WIG20 (10)', currency: 'PLN', tickers: ['PKN.WA', 'PKO.WA', 'PZU.WA', 'KGH.WA', 'DNP.WA', 'LPP.WA', 'CDR.WA', 'ALE.WA', 'MBK.WA', 'OPL.WA'] },
  { id: 'mwig40', name: 'PL mWIG40 (lista przyblizona)', currency: 'PLN', tickers: MWIG40 },
];

export function getUniverse(id: string): UniverseDef | null {
  const k = String(id || '').trim().toLowerCase();
  return UNIVERSES.find((u) => u.id === k) || null;
}
