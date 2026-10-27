import { InvestService } from './service.js';
import { STRATEGIES } from './strategies.js';
import { UNIVERSES } from './universe.js';
import { runMonthly } from './monthly.js';
import { pct } from './util.js';

export interface OmniToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, string>;
  requiresApproval: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface OmniTool { definition: OmniToolDefinition; execute: (args: any) => Promise<string> }

export function buildInvestTools(service: InvestService): OmniTool[] {
  return [
    {
      definition: { name: 'invest_list_strategies', description: 'Lista strategii inwestycyjnych i uniwersow dostepnych w omni-invest.', parameters: {}, requiresApproval: false, timeoutMs: 5000, maxOutputBytes: 3000 },
      execute: async () => {
        const nl = String.fromCharCode(10);
        const s = STRATEGIES.map((x) => '- ' + x.id + ': ' + x.name + ' — ' + x.description);
        const u = UNIVERSES.map((x) => '- ' + x.id + ': ' + x.name);
        return ['STRATEGIE:', ...s, '', 'UNIWERSA:', ...u, '', 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.'].join(nl);
      },
    },
    {
      definition: { name: 'invest_run_strategy', description: 'Uruchamia screening strategii na uniwersum i zwraca ranking z uzasadnieniem (dane z Yahoo/Stooq). Parametry: strategy, universe.', parameters: { strategy: 'string', universe: 'string' }, requiresApproval: false, timeoutMs: 120000, maxOutputBytes: 6000 },
      execute: async (args: any) => {
        const { text } = await service.screen(String(args && args.strategy || 'momentum'), String(args && args.universe || 'us-mega'));
        return text;
      },
    },
    {
      definition: { name: 'invest_backtest', description: 'Backtest miesieczny (tylko czynniki cenowe) z kosztami i benchmarkiem. Parametry: strategy, universe, months.', parameters: { strategy: 'string', universe: 'string', months: 'number' }, requiresApproval: false, timeoutMs: 180000, maxOutputBytes: 4000 },
      execute: async (args: any) => {
        const { text } = await service.backtest(String(args && args.strategy || 'momentum'), String(args && args.universe || 'us-mega'), Number(args && args.months) || undefined);
        return text;
      },
    },
    {
      definition: { name: 'invest_portfolio', description: 'Deterministyczna analiza portfela: sumy, udzialy, koncentracja (USA/tech/waluta), alokacja docelowa, podzial miesiecznej wplaty i rebalans. Parametry: holdings (np. "S&P 500=4917.37; MSCI World=3643.34; ..."), monthly (kwota), targets (opcjonalnie).', parameters: { holdings: 'string', monthly: 'number', targets: 'string' }, requiresApproval: false, timeoutMs: 15000, maxOutputBytes: 7000 },
      execute: async (args: any) => {
        const { runPortfolio, parseHoldings } = await import('./portfolio.js');
        const holdings = parseHoldings(args && args.holdings);
        let targets: Record<string, number> = {};
        if (args && args.targets) { for (const p of String(args.targets).split(';')) { const [k, v] = p.split('='); if (k && v) { targets[k.trim()] = Number(v); } } }
        const r = runPortfolio(holdings, args && args.monthly, targets);
        const nl = String.fromCharCode(10);
        const pct = (x: number) => (x * 100).toFixed(1) + '%';
        const out: string[] = [];
        out.push('PORTFEL: ' + r.total.toFixed(2) + ' PLN');
        out.push('');
        for (const x of r.rows) { out.push('- ' + x.label + ': ' + x.value.toFixed(2) + ' PLN | ' + pct(x.weight) + ' | cel ' + pct(x.target) + ' | roznica ' + ((x.delta * 100) >= 0 ? '+' : '') + (x.delta * 100).toFixed(1) + ' pp' + (x.monthly > 0 ? ' | z 600 zł: ' + x.monthly.toFixed(0) : '')); }
        out.push('');
        out.push('Koszyki: akcje ' + pct(r.buckets.equity) + ' | zloto ' + pct(r.buckets.gold) + ' | krypto ' + pct(r.buckets.crypto) + ' | obligacje ' + pct(r.buckets.bonds));
        out.push('Koncentracja: USA ' + pct(r.usShare) + ' | tech ' + pct(r.techShare) + ' | waluta USD ' + pct(r.usdShare));
        if (r.notes.length) { out.push(''); for (const n of r.notes) { out.push('UWAGA: ' + n); } }
        out.push(''); out.push(r.disclaimer);
        return out.join(nl);
      },
    },
    {
      definition: { name: 'invest_rebalance', description: 'Liczy rebalans portfela: co dokupic i co sprzedac, by wrocic do wag docelowych. Parametry: holdings (np. "CSPX.L=6000,NVDA=4000"), targets (np. "CSPX.L=0.8,NVDA=0.2").', parameters: { holdings: 'string', targets: 'string' }, requiresApproval: false, timeoutMs: 10000, maxOutputBytes: 3000 },
      execute: async (args: any) => {
        const { runRebalance } = await import('./rebalance.js');
        const parse = (s: string) => { const o: Record<string, number> = {}; for (const part of String(s || '').split(',')) { const [k, v] = part.split('='); if (k && v) { o[k.trim()] = Number(v); } } return o; };
        const r = runRebalance(parse(args && args.holdings), parse(args && args.targets));
        const nl = String.fromCharCode(10);
        const out = ['REBALANS (portfel ' + r.total + '):'];
        for (const x of r.rows) { out.push('- ' + x.ticker + ': obecnie ' + (x.currentWeight * 100).toFixed(1) + '% -> cel ' + (x.targetWeight * 100).toFixed(1) + '% | ' + x.action + ' ' + Math.abs(x.amount).toFixed(2)); }
        for (const n of r.notes) { out.push('UWAGA: ' + n); }
        out.push(''); out.push(r.disclaimer);
        return out.join(nl);
      },
    },
    {
      definition: { name: 'invest_compare', description: 'Porownuje 2-8 instrumentow na tym samym okresie: zwrot, zmiennosc, max obsuniecie, Sharpe, beta i korelacja do S&P 500. Parametry: tickers (np. "NVDA,^NDX,GLD"), days (domyslnie 400).', parameters: { tickers: 'string', days: 'number' }, requiresApproval: false, timeoutMs: 120000, maxOutputBytes: 4000 },
      execute: async (args: any) => {
        const { runCompare } = await import('./compare.js');
        const list = String((args && args.tickers) || '').split(',').map((x) => x.trim()).filter(Boolean);
        const res = await runCompare(service, list, Number(args && args.days) || undefined);
        const nl = String.fromCharCode(10);
        const out = ['POROWNANIE (' + res.from + ' - ' + res.asOf + ', ' + res.days + ' dni):'];
        for (const r of res.rows) {
          out.push('- ' + r.ticker + ': zwrot ' + (r.ret === null ? '-' : pct(r.ret)) + ' | zmiennosc ' + (r.vol === null ? '-' : pct(r.vol)) + ' | maxDD ' + (r.maxDD === null ? '-' : pct(r.maxDD)) + ' | Sharpe ' + (r.sharpe === null ? '-' : r.sharpe) + ' | beta ' + (r.beta === null ? '-' : r.beta) + ' | korelacja ' + (r.corr === null ? '-' : r.corr));
        }
        if (res.notes.length) { out.push(''); for (const n of res.notes) { out.push('UWAGA: ' + n); } }
        out.push(''); out.push(res.disclaimer);
        return out.join(nl);
      },
    },
    {
      definition: { name: 'invest_quote', description: 'Notowanie (ostatnie zamkniecie) dla tickera, np. AAPL lub PKN.WA.', parameters: { ticker: 'string' }, requiresApproval: false, timeoutMs: 30000, maxOutputBytes: 1000 },
      execute: async (args: any) => service.quote(String(args && args.ticker || '')),
    },
    {
      definition: { name: 'invest_monthly_run', description: 'Miesieczny przeglad: uruchamia plan (domyslnie core@mwig40 + momentum@sp500), zapisuje migawki i raport do ~/.omni/invest/reports.', parameters: {}, requiresApproval: false, timeoutMs: 900000, maxOutputBytes: 9000 },
      execute: async () => runMonthly(service),
    },
    {
      definition: { name: 'invest_last_snapshot', description: 'Ostatnia zapisana migawka screeningu (kto byl w portfelu).', parameters: {}, requiresApproval: false, timeoutMs: 5000, maxOutputBytes: 2000 },
      execute: async () => service.lastSnapshot(),
    },
  ];
}

export function registerInvestTools(register: (t: OmniTool) => void, service: InvestService): void {
  for (const t of buildInvestTools(service)) { register(t); }
}
