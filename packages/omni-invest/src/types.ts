export type FactorId = 'value' | 'quality' | 'momentum' | 'lowVol';

export interface Bar { date: string; close: number; volume?: number | null }
export interface Quote { ticker: string; date: string; close: number }

export interface Fundamentals {
  ticker: string;
  asOf: string;
  pe?: number | null;
  pb?: number | null;
  evEbitda?: number | null;
  roe?: number | null;
  grossMargin?: number | null;
  debtToEquity?: number | null;
  fcfYield?: number | null;
  sector?: string | null;
}

export interface PriceProvider {
  id: string;
  getDailyBars(ticker: string, from: string, to: string): Promise<Bar[]>;
  getQuote(ticker: string): Promise<Quote | null>;
}

export interface FundamentalsProvider {
  id: string;
  getFundamentals(ticker: string): Promise<Fundamentals | null>;
}

export interface UniverseDef { id: string; name: string; tickers: string[]; currency?: string }

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  weights: Partial<Record<FactorId, number>>;
  topN: number;
  minCoverage?: number;
  maxPerSector?: number;
}

export type TickerMetrics = Record<string, number | null>;

export interface ScoredTicker {
  ticker: string;
  score: number;
  rank: number;
  contributions: Record<string, number>;
  metrics: TickerMetrics;
}

export interface ScreenResult {
  strategy: string;
  strategyName: string;
  universe: string;
  asOf: string;
  picks: ScoredTicker[];
  skipped: number;
  notes: string[];
}

export interface BacktestPoint { date: string; value: number }

export interface BacktestResult {
  strategy: string;
  universe: string;
  from: string;
  to: string;
  equity: BacktestPoint[];
  cagr: number;
  vol: number;
  sharpe: number;
  maxDrawdown: number;
  benchmarkCagr: number | null;
  turnover: number;
  costBps: number;
  rebalances: number;
  notes: string[];
}

export interface Snapshot { id: string; at: string; strategy: string; universe: string; picks: ScoredTicker[] }

export interface AnnualPoint { end: string; year: number; value: number }

export interface EquityFundamentals {
  ticker: string;
  eps: AnnualPoint[];
  revenue: AnnualPoint[];
  equity: AnnualPoint[];
  liabilities: AnnualPoint[];
  netIncome: AnnualPoint[];
  ocf: AnnualPoint[];
  capex: AnnualPoint[];
  shares: AnnualPoint[];
}