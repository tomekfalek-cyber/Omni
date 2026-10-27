import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InvestService } from './service.js';

export interface MonthlyPlanItem { strategy: string; universe: string }

// Domyslnie TYLKO czynniki cenowe - dzialaja bez zadnego klucza API.
// Strategie value/quality wymagaja FMP_API_KEY (inaczej nie maja danych).
export const DEFAULT_MONTHLY_PLAN: MonthlyPlanItem[] = [
  { strategy: 'lowvol', universe: 'mwig40' },
  { strategy: 'momentum', universe: 'sp500' },
];

export function planFromEnv(): MonthlyPlanItem[] {
  const raw = String(process.env.INVEST_MONTHLY_PLAN || '').trim();
  if (!raw) { return DEFAULT_MONTHLY_PLAN; }
  const out: MonthlyPlanItem[] = [];
  for (const part of raw.split(',')) {
    const [s, u] = part.split(':').map((x) => String(x || '').trim());
    if (s && u) { out.push({ strategy: s, universe: u }); }
  }
  return out.length ? out : DEFAULT_MONTHLY_PLAN;
}

export async function runMonthly(service: InvestService, plan?: MonthlyPlanItem[]): Promise<string> {
  const nl = String.fromCharCode(10);
  const items = plan && plan.length ? plan : planFromEnv();
  const started = Date.now();
  const blocks: string[] = [];
  const errors: string[] = [];
  for (const item of items) {
    try {
      const t0 = Date.now();
      const res = await service.screen(item.strategy, item.universe);
      blocks.push('## ' + item.strategy + ' @ ' + item.universe);
      blocks.push(res.text);
      blocks.push('(czas: ' + Math.round((Date.now() - t0) / 1000) + ' s)');
    } catch (e: any) {
      errors.push(item.strategy + ' @ ' + item.universe + ': ' + String(e && e.message));
    }
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const head = ['# Miesieczny przeglad inwestycyjny - ' + stamp, '', 'Plan: ' + items.map((i) => i.strategy + '@' + i.universe).join(', '), ''];
  const body = head.concat(blocks).join(nl);
  try {
    const dir = path.join(os.homedir(), '.omni', 'invest', 'reports');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, stamp + '.md'), body, 'utf8');
  } catch (e) { }
  const out = [body];
  if (errors.length) { out.push(''); out.push('BLEDY:'); for (const e of errors) { out.push('- ' + e); } }
  out.push('');
  out.push('Czas calosci: ' + Math.round((Date.now() - started) / 1000) + ' s');
  return out.join(nl);
}
