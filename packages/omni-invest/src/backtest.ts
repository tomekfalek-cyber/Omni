import { BacktestPoint, BacktestResult, Bar, PriceProvider, StrategyDef, UniverseDef } from './types.js';
import { daysAgo, mapLimit, mean, round, stdev, todayIso } from './util.js';

export interface BacktestOptions {
  strategy: StrategyDef;
  universe: UniverseDef;
  price: PriceProvider;
  months?: number;
  topN?: number;
  costBps?: number;
  concurrency?: number;
}

function monthEnds(bars: Bar[]): Map<string, number> {
  const m = new Map<string, number>();
  const sorted = bars.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const b of sorted) { m.set(b.date.slice(0, 7), b.close); }
  return m;
}

export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  const months = Math.max(18, Math.min(120, opts.months ?? 36));
  const topN = opts.topN ?? opts.strategy.topN;
  const costBps = opts.costBps ?? 10;
  const notes: string[] = [];
  const priceOnly = !Object.keys(opts.strategy.weights).some((k) => k === 'value' || k === 'quality');
  if (!priceOnly) {
    notes.push('Backtest liczy TYLKO czynniki cenowe (momentum/lowVol). Value/quality pominiete - brak danych point-in-time (unikamy lookahead).');
  }

  const to = todayIso();
  const from = daysAgo(Math.round(months * 31 + 420));
  const barsByTicker = await mapLimit(opts.universe.tickers, opts.concurrency ?? 4, async (t) => {
    try { return { ticker: t, bars: await opts.price.getDailyBars(t, from, to) }; } catch (e) { return { ticker: t, bars: [] as Bar[] }; }
  });

  const series = new Map<string, Map<string, number>>();
  for (const b of barsByTicker) { if (b.bars.length) { series.set(b.ticker, monthEnds(b.bars)); } }
  if (series.size < 2) { throw new Error('Za malo spolek z danymi do backtestu'); }

  const allMonths = new Set<string>();
  for (const m of series.values()) { for (const k of m.keys()) { allMonths.add(k); } }
  const monthList = Array.from(allMonths).sort();
  if (monthList.length < 16) { throw new Error('Za malo miesiecy danych (' + monthList.length + ')'); }

  const tickers = Array.from(series.keys());
  const equity: BacktestPoint[] = [];
  let value = 1;
  let prevPicks: string[] = [];
  let turnovers: number[] = [];
  const portRets: number[] = [];
  const benchRets: number[] = [];
  let rebalances = 0;

  for (let i = 13; i < monthList.length - 1; i++) {
    const m = monthList[i];
    const scored: Array<{ t: string; s: number }> = [];
    for (const t of tickers) {
      const ser = series.get(t)!;
      const cur = ser.get(monthList[i - 1]);
      const past = ser.get(monthList[i - 13]);
      if (cur === undefined || past === undefined || !(past > 0)) { continue; }
      const mom = cur / past - 1;
      const rets: number[] = [];
      for (let j = Math.max(1, i - 12); j <= i - 1; j++) {
        const a = ser.get(monthList[j - 1]), b = ser.get(monthList[j]);
        if (a && b && a > 0) { rets.push(b / a - 1); }
      }
      const vol = rets.length >= 6 ? stdev(rets) : null;
      const wMom = opts.strategy.weights.momentum || 0;
      const wVol = opts.strategy.weights.lowVol || 0;
      if (wMom === 0 && wVol === 0) { continue; }
      let s = 0, wsum = 0;
      if (wMom > 0) { s += mom * wMom; wsum += wMom; }
      if (wVol > 0 && vol !== null) { s += -vol * wVol; wsum += wVol; }
      if (wsum === 0) { continue; }
      scored.push({ t, s: s / wsum });
    }
    if (!scored.length) { continue; }
    scored.sort((a, b) => b.s - a.s);
    const picks = scored.slice(0, Math.min(topN, scored.length)).map((x) => x.t);
    const changed = picks.filter((p) => prevPicks.indexOf(p) === -1).length;
    const turnover = prevPicks.length ? changed / picks.length : 1;
    turnovers.push(turnover);
    prevPicks = picks;

    const rets: number[] = [];
    for (const t of picks) {
      const ser = series.get(t)!;
      const a = ser.get(monthList[i]), b = ser.get(monthList[i + 1]);
      if (a && b && a > 0) { rets.push(b / a - 1); }
    }
    if (!rets.length) { continue; }
    const gross = mean(rets);
    const net = gross - turnover * (costBps / 10000);
    portRets.push(net);
    value = value * (1 + net);
    equity.push({ date: monthList[i + 1], value: round(value, 6) });
    rebalances++;

    const brets: number[] = [];
    for (const t of tickers) {
      const ser = series.get(t)!;
      const a = ser.get(monthList[i]), b = ser.get(monthList[i + 1]);
      if (a && b && a > 0) { brets.push(b / a - 1); }
    }
    if (brets.length) { benchRets.push(mean(brets)); }
  }

  if (!equity.length) { throw new Error('Backtest nie wygenerowal zadnego okresu'); }

  const years = equity.length / 12;
  const cagr = years > 0 ? Math.pow(value, 1 / years) - 1 : 0;
  const vol = stdev(portRets) * Math.sqrt(12);
  const sharpe = vol > 1e-9 ? cagr / vol : 0;
  let peak = 0, maxDD = 0;
  for (const p of equity) { if (p.value > peak) { peak = p.value; } const dd = peak > 0 ? p.value / peak - 1 : 0; if (dd < maxDD) { maxDD = dd; } }
  const benchValue = benchRets.reduce((acc, r) => acc * (1 + r), 1);
  const benchYears = benchRets.length / 12;
  const benchmarkCagr = benchYears > 0 ? Math.pow(benchValue, 1 / benchYears) - 1 : null;

  return {
    strategy: opts.strategy.id,
    universe: opts.universe.id,
    from: equity[0].date,
    to: equity[equity.length - 1].date,
    equity,
    cagr: round(cagr, 4),
    vol: round(vol, 4),
    sharpe: round(sharpe, 3),
    maxDrawdown: round(maxDD, 4),
    benchmarkCagr: benchmarkCagr === null ? null : round(benchmarkCagr, 4),
    turnover: round(turnovers.length ? mean(turnovers) : 0, 4),
    costBps,
    rebalances,
    notes,
  };
}
