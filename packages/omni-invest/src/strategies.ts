import { StrategyDef } from './types.js';

export const STRATEGIES: StrategyDef[] = [
  { id: 'momentum', name: 'Momentum 12-1', description: 'Sila trendu: zwrot z ostatnich 12 mies. bez ostatniego miesiaca.', weights: { momentum: 1 }, topN: 5, minCoverage: 0.99 },
  { id: 'lowvol', name: 'Low volatility', description: 'Najnizsza zmiennosc dzienna (annualizowana).', weights: { lowVol: 1 }, topN: 5, minCoverage: 0.99 },
  { id: 'quality', name: 'Quality', description: 'ROE, marza brutto, niskie zadluzenie.', weights: { quality: 1 }, topN: 5, minCoverage: 0.5 },
  { id: 'value', name: 'Value', description: 'Zysk/wartosc ksiegi/FCF - im taniej, tym lepiej.', weights: { value: 1 }, topN: 5, minCoverage: 0.4 },
  { id: 'core', name: 'Core mix', description: 'Value + quality + momentum + low-vol (zbalansowany).', weights: { value: 0.3, quality: 0.3, momentum: 0.25, lowVol: 0.15 }, topN: 5, minCoverage: 0.6, maxPerSector: 2 },
  { id: 'defensive', name: 'Defensive', description: 'Niska zmiennosc + jakosc + wycena.', weights: { lowVol: 0.4, quality: 0.4, value: 0.2 }, topN: 5, minCoverage: 0.5, maxPerSector: 2 },
];

export function getStrategy(id: string): StrategyDef | null {
  const k = String(id || '').trim().toLowerCase();
  return STRATEGIES.find((s) => s.id === k) || null;
}

export function priceOnly(s: StrategyDef): boolean {
  return !Object.keys(s.weights).some((k) => k === 'value' || k === 'quality');
}
