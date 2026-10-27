import { InvestService } from './service.js';
import { STRATEGIES } from './strategies.js';
import { UNIVERSES } from './universe.js';

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
      definition: { name: 'invest_quote', description: 'Notowanie (ostatnie zamkniecie) dla tickera, np. AAPL lub PKN.WA.', parameters: { ticker: 'string' }, requiresApproval: false, timeoutMs: 30000, maxOutputBytes: 1000 },
      execute: async (args: any) => service.quote(String(args && args.ticker || '')),
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
