import { Bar, EquityFundamentals } from './types.js';
import { InvestService } from './service.js';
import { EdgarProvider } from './providers/edgar.js';
import { annualSeries, computeValuation, Valuation } from './fundamentals.js';
import { annVol, dailyReturns, daysAgo, mapLimit, round, stdev, todayIso } from './util.js';

export interface CompanyDef { ticker: string; name: string; sector: string; description: string }

// Lista spolki o profilu dlugoterminowym (jakosc + wzrost + wycena).
export const COMPANIES: CompanyDef[] = [
  { ticker: 'AAPL', name: 'Apple', sector: 'Technologia', description: 'Projektuje i sprzedaje smartfony, komputery oraz uslugi cyfrowe (App Store, iCloud).' },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'Technologia', description: 'Systemy operacyjne, chmura Azure i oprogramowanie biurowe w subskrypcji.' },
  { ticker: 'GOOGL', name: 'Alphabet', sector: 'Technologia', description: 'Wyszukiwarka, reklama cyfrowa, YouTube i chmura Google Cloud.' },
  { ticker: 'AMZN', name: 'Amazon', sector: 'Handel/Chmura', description: 'Handel internetowy, logistyka i chmura AWS (glowne zrodlo zysku).' },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'Polprzewodniki', description: 'Procesory graficzne i akceleratory AI dla centrow danych.' },
  { ticker: 'META', name: 'Meta Platforms', sector: 'Technologia', description: 'Facebook, Instagram, WhatsApp; przychody glownie z reklamy cyfrowej.' },
  { ticker: 'AVGO', name: 'Broadcom', sector: 'Polprzewodniki', description: 'Uklady scalone i oprogramowanie infrastrukturalne dla firm.' },
  { ticker: 'ORCL', name: 'Oracle', sector: 'Oprogramowanie', description: 'Bazy danych, systemy enterprise i chmura Oracle Cloud.' },
  { ticker: 'ADBE', name: 'Adobe', sector: 'Oprogramowanie', description: 'Oprogramowanie kreatywne (Photoshop, PDF) w modelu subskrypcji.' },
  { ticker: 'CRM', name: 'Salesforce', sector: 'Oprogramowanie', description: 'Systemy CRM w chmurze dla sprzedazy i obslugi klienta.' },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'Finanse', description: 'Najwiekszy bank USA: kredyty, bankowosc inwestycyjna, karty.' },
  { ticker: 'V', name: 'Visa', sector: 'Finanse', description: 'Sieci platnosci kartowych - zarabia na prowizjach od transakcji.' },
  { ticker: 'MA', name: 'Mastercard', sector: 'Finanse', description: 'Sieci platnosci kartowych, model prowizyjny.' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Zdrowie', description: 'Farmaceutyka i wyroby medyczne, stabilne przeplywy.' },
  { ticker: 'PG', name: 'Procter & Gamble', sector: 'Dobra konsumenckie', description: 'Marki codziennego uzytku (Pampers, Gillette, Tide).' },
  { ticker: 'KO', name: 'Coca-Cola', sector: 'Dobra konsumenckie', description: 'Napoje bezalkoholowe, globalna dystrybucja.' },
  { ticker: 'PEP', name: 'PepsiCo', sector: 'Dobra konsumenckie', description: 'Napoje i przekaski (Pepsi, Lay\'s, Quaker).' },
  { ticker: 'XOM', name: 'Exxon Mobil', sector: 'Energia', description: 'Ropa, gaz ziemny i rafinacja; zysk silnie zwiazany z cenami surowca.' },
  { ticker: 'COST', name: 'Costco', sector: 'Handel', description: 'Hurtownie czlonkowskie - stabilny model subskrypcyjny.' },
  { ticker: 'LLY', name: 'Eli Lilly', sector: 'Zdrowie', description: 'Farmaceutyka, m.in. leki z grupy GLP-1 (cukrzyca/otylosc).' },
];

export const GLOSSARY: Array<{ term: string; desc: string }> = [
  { term: 'P/E', desc: 'Cena podzielona przez zysk na akcję. Mówi, ile płacisz za 1 zł zysku spółki. Niżej = taniej.' },
  { term: 'P/B', desc: 'Cena podzielona przez wartość księgową. Ile płacisz za 1 zł majątku netto firmy.' },
  { term: 'ROE', desc: 'Zysk podzielony przez kapitał własny. Pokazuje, jak efektywnie firma pomnaża kapitał. Wyżej = lepszy biznes.' },
  { term: 'FCF yield', desc: 'Wolna gotówka (po inwestycjach) w relacji do wyceny. Ile realnej gotówki generuje biznes. Wyżej = lepiej.' },
  { term: 'D/E', desc: 'Zobowiązania podzielone przez kapitał własny. Poziom zadłużenia. Niżej = bezpieczniej.' },
  { term: 'CAGR', desc: 'Średnioroczne tempo wzrostu w procentach (np. przychodów lub zysku na akcję).' },
  { term: 'Bear / Base / Bull', desc: 'Scenariusz pesymistyczny / bazowy / optymistyczny. To wyliczenie matematyczne, nie prognoza ceny.' },
];
export interface Scenario { bear: number | null; base: number | null; bull: number | null; growth: number | null; multiple: number | null }

export interface DeepRow {
  ticker: string; name: string; sector: string; description: string;
  price: number | null; vol: number | null; trend: 'up' | 'down' | null;
  metrics: Valuation;
  score: number; rank: number;
  undervalued: boolean;
  quality: number | null; growth: number | null; value: number | null;
  beta: number | null; maxDD: number | null; sharpe: number | null; sortino: number | null;
  pePercentile: number | null; tier: string; weight: number | null;
  scenarios: Scenario;
  thesis: string[];
  risks: string[];
}

export interface DeepResult {
  asOf: string;
  glossary: Array<{ term: string; desc: string }>;
  portfolio: any;
  assumptions: string[];
  rows: DeepRow[];
  buy: string[];
  undervalued: string[];
  notes: string[];
  disclaimer: string;
}

function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) { return null; }
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function z(vals: Array<number | null>, invert = false): Array<number | null> {
  const ok = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (ok.length < 3) { return vals.map(() => null); }
  const m = ok.reduce((s, x) => s + x, 0) / ok.length;
  const sd = stdev(ok);
  if (sd <= 1e-12) { return vals.map((v) => (v === null ? null : 0)); }
  return vals.map((v) => (v === null ? null : ((v - m) / sd) * (invert ? -1 : 1)));
}

function pctS(x: number | null): string { return x === null ? 'brak danych' : (x * 100).toFixed(1) + '%'; }
function numS(x: number | null, d = 1): string { return x === null ? 'brak danych' : x.toFixed(d); }

export async function runDeep(service: InvestService, edgar?: EdgarProvider, limit = 20): Promise<DeepResult> {
  const ed = edgar || new EdgarProvider();
  const from = daysAgo(1900);
  const to = todayIso();
  const list = COMPANIES.slice(0, limit);
  const notes: string[] = [];

  const spyBars = await service.price.getDailyBars('SPY', from, to).catch(() => [] as Bar[]);
  const spyRet = new Map<string, number>();
  for (let i = 1; i < spyBars.length; i++) { const a = spyBars[i - 1].close, b = spyBars[i].close; if (a > 0) { spyRet.set(spyBars[i].date, b / a - 1); } }
  const raw = await mapLimit(list, 3, async (c) => {
    let bars: Bar[] = [];
    try { bars = await service.price.getDailyBars(c.ticker, from, to); } catch (e) { bars = []; }
    const closes = bars.map((b) => b.close);
    const price = closes.length ? closes[closes.length - 1] : null;
    const rets = dailyReturns(closes.slice(-252));
    const vol = rets.length > 30 ? annVol(rets) : null;
    let trend: 'up' | 'down' | null = null;
    if (closes.length >= 50) { const sma = closes.slice(-50).reduce((s, x) => s + x, 0) / 50; trend = closes[closes.length - 1] >= sma ? 'up' : 'down'; }
    type SeriesKey = 'eps' | 'revenue' | 'equity' | 'liabilities' | 'netIncome' | 'ocf' | 'capex' | 'shares';
    const tags: Array<[SeriesKey, string]> = [
      ['eps', 'EarningsPerShareDiluted'],
      ['revenue', 'Revenues'],
      ['equity', 'StockholdersEquity'],
      ['liabilities', 'Liabilities'],
      ['netIncome', 'NetIncomeLoss'],
      ['ocf', 'NetCashProvidedByUsedInOperatingActivities'],
      ['capex', 'PaymentsToAcquirePropertyPlantAndEquipment'],
      ['shares', 'CommonStockSharesOutstanding'],
    ];
    const f: EquityFundamentals = { ticker: c.ticker, eps: [], revenue: [], equity: [], liabilities: [], netIncome: [], ocf: [], capex: [], shares: [] };
    for (const [key, tag] of tags) {
      try { const con = await ed.concept(c.ticker, tag); if (con) { f[key] = annualSeries(con); } } catch (e) { }
      if (key === 'eps' && !f.eps.length) {
        for (const alt of ['EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic']) {
          try { const con = await ed.concept(c.ticker, alt); if (con) { const s = annualSeries(con); if (s.length) { f.eps = s; break; } } } catch (e) { }
        }
      }
    }
    // Fallbacki tagow - rozne spolki raportuja te same dane pod innymi nazwami.
    if (!f.revenue.length) {
      for (const alt of ['RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']) {
        try { const con = await ed.concept(c.ticker, alt); if (con) { const s = annualSeries(con); if (s.length) { f.revenue = s; break; } } } catch (e) { }
      }
    }
    if (!f.equity.length) {
      for (const alt of ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']) {
        try { const con = await ed.concept(c.ticker, alt); if (con) { const s = annualSeries(con); if (s.length) { f.equity = s; break; } } } catch (e) { }
      }
    }
    if (!f.liabilities.length) {
      try {
        const ca = await ed.concept(c.ticker, 'Assets');
        if (ca) {
          const assets = annualSeries(ca);
          if (assets.length && f.equity.length) {
            const eqByEnd = new Map(f.equity.map((p) => [p.end, p.value]));
            f.liabilities = assets.filter((a) => eqByEnd.has(a.end)).map((a) => ({ end: a.end, year: a.year, value: a.value - (eqByEnd.get(a.end) as number) }));
          }
        }
      } catch (e) { }
    }
    // Akcje: jesli brak tagu (czesto w innej taksonomii), wylicz z zysku netto / EPS.
    if (!f.shares.length && f.netIncome.length && f.eps.length) {
      const epsLast = f.eps[f.eps.length - 1].value;
      const niLast = f.netIncome[f.netIncome.length - 1].value;
      if (epsLast > 0 && niLast > 0) { f.shares = [{ end: f.eps[f.eps.length - 1].end, year: f.eps[f.eps.length - 1].year, value: niLast / epsLast }]; }
    }
    // NAPRAWA: jesli najswiezsze przychody sa starsze niz 2 lata, sprobuj innych tagow (SEC bywa nieaktualne pod 'Revenues').
    const rokBiezacy = new Date().getUTCFullYear();
    if (f.revenue.length && f.revenue[f.revenue.length - 1].year < rokBiezacy - 2) {
      for (const alt of ['RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']) {
        try {
          const con = await ed.concept(c.ticker, alt);
          if (con) {
            const s = annualSeries(con);
            if (s.length && s[s.length - 1].year > f.revenue[f.revenue.length - 1].year) { f.revenue = s; break; }
          }
        } catch (e) { }
      }
    }
    let rev = f.revenue;
    if (!rev.length) { try { const con = await ed.concept(c.ticker, 'RevenueFromContractWithCustomerExcludingAssessedTax'); if (con) { rev = annualSeries(con); f.revenue = rev; } } catch (e) { } }
    const metrics = computeValuation(price, f);
    // --- metryki profesjonalne ---
    const closAll = bars.map((b) => b.close);
    const l3 = closAll.slice(-756);
    let pk = l3.length ? l3[0] : 0, mdd = 0;
    for (const cc of l3) { if (cc > pk) { pk = cc; } const dd = pk > 0 ? cc / pk - 1 : 0; if (dd < mdd) { mdd = dd; } }
    const rs: number[] = []; const bs: number[] = [];
    for (let i = 1; i < bars.length; i++) { const a = bars[i - 1].close, b2 = bars[i].close; if (!(a > 0)) { continue; } const rr = b2 / a - 1; const mm = spyRet.get(bars[i].date); if (mm === undefined) { continue; } rs.push(rr); bs.push(mm); }
    let beta: number | null = null;
    if (rs.length > 60) { const mr = rs.reduce((s, x) => s + x, 0) / rs.length; const mb = bs.reduce((s, x) => s + x, 0) / bs.length; let cov = 0, varb = 0; for (let i = 0; i < rs.length; i++) { cov += (rs[i] - mr) * (bs[i] - mb); varb += (bs[i] - mb) * (bs[i] - mb); } if (varb > 0) { beta = cov / varb; } }
    let sharpe: number | null = null, sortino: number | null = null;
    if (rs.length > 60) { const mu = rs.reduce((s, x) => s + x, 0) / rs.length; const sd = stdev(rs); const dn = rs.filter((x) => x < 0).map((x) => x * x); const dsd = Math.sqrt(dn.reduce((s, x) => s + x, 0) / Math.max(1, dn.length)); sharpe = sd > 0 ? (mu * 252) / (sd * Math.sqrt(252)) : null; sortino = dsd > 0 ? (mu * 252) / (dsd * Math.sqrt(252)) : null; }
    const peHist: number[] = [];
    for (const p of f.eps) { const idx = bars.findIndex((b3) => b3.date >= p.end); if (idx >= 0 && p.value > 0) { const peH = bars[idx].close / p.value; if (peH > 0 && peH < 200) { peHist.push(peH); } } }
    const pePercentile = (peHist.length >= 3 && metrics.pe !== null) ? peHist.filter((x) => x < (metrics.pe as number)).length / peHist.length : null;
    // NAPRAWA jakosci: brak EPS -> policz z zysku netto / liczby akcji.
    if ((metrics.pe === null || (metrics.pe as number) > 150) && metrics.netIncome !== null && metrics.netIncome > 0 && metrics.shares !== null && metrics.shares > 0 && price !== null) {
      const epsImplied = metrics.netIncome / metrics.shares;
      if (epsImplied > 0) { metrics.eps = epsImplied; metrics.pe = price / epsImplied; }
    }
    // Limity sensownosci (odcinaja smieci z roznych definicji/tagow).
    if (metrics.pe !== null && ((metrics.pe as number) < 2 || (metrics.pe as number) > 150)) { metrics.pe = null; }
    if (metrics.pb !== null && ((metrics.pb as number) < 0.1 || (metrics.pb as number) > 100)) { metrics.pb = null; }
    if (metrics.roe !== null) { metrics.roe = Math.max(-1, Math.min(3, metrics.roe as number)); }
    // Marza netto >100% oznacza blad danych (zazwyczaj nieaktualne przychody) - nie pokazuj smieci.
    if (metrics.netMargin !== null && ((metrics.netMargin as number) > 1 || (metrics.netMargin as number) < -1)) { metrics.netMargin = null; }
    // Banki: D/E i FCF nie maja sensu (zobowiazania = depozyty).
    if (c.sector === 'Finanse') { metrics.debtToEquity = null; metrics.fcf = null; metrics.fcfYield = null; }
    return { def: c, bars, price, vol, trend, metrics, beta, mdd, sharpe, sortino, pePercentile };
  });

  const peMed = median(raw.map((r) => r.metrics.pe).filter((x): x is number => x !== null && x > 0));
  const pbMed = median(raw.map((r) => r.metrics.pb).filter((x): x is number => x !== null && x > 0));

  const q = raw.map((r) => {
    const parts: number[] = [];
    if (r.metrics.roe !== null) { parts.push(r.metrics.roe); }
    if (r.metrics.netMargin !== null) { parts.push(r.metrics.netMargin * 2); }
    if (r.metrics.debtToEquity !== null) { parts.push(-r.metrics.debtToEquity * 0.5); }
    return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
  });
  const g = raw.map((r) => {
    const parts: number[] = [];
    if (r.metrics.revCagr3 !== null) { parts.push(r.metrics.revCagr3); }
    if (r.metrics.epsCagr3 !== null) { parts.push(r.metrics.epsCagr3 * 1.5); }
    return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
  });
  const v = raw.map((r) => {
    const parts: number[] = [];
    if (r.metrics.pe !== null && r.metrics.pe > 0) { parts.push(-r.metrics.pe / 20); }
    if (r.metrics.pb !== null && r.metrics.pb > 0) { parts.push(-r.metrics.pb / 5); }
    if (r.metrics.fcfYield !== null) { parts.push(r.metrics.fcfYield * 10); }
    return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
  });
  const st = raw.map((r) => (r.vol === null ? null : -r.vol));

  const qz = z(q), gz = z(g), vz = z(v), sz = z(st);

  const rows: DeepRow[] = raw.map((r, i) => {
    const parts: number[] = [];
    if (qz[i] !== null) { parts.push((qz[i] as number) * 0.4); }
    if (gz[i] !== null) { parts.push((gz[i] as number) * 0.25); }
    if (vz[i] !== null) { parts.push((vz[i] as number) * 0.25); }
    if (sz[i] !== null) { parts.push((sz[i] as number) * 0.1); }
    const score = parts.length ? parts.reduce((s, x) => s + x, 0) : -9;
    const m = r.metrics;
    const growth = m.epsCagr3 !== null ? m.epsCagr3 : (m.revCagr3 !== null ? m.revCagr3 : null);
    // Limity: wzrost max 15%/rok, mnoznik max 25x - inaczej scenariusze uciekaja w absurd.
    const gg = growth === null ? 0.05 : Math.max(-0.05, Math.min(0.15, growth));
    const basePE = peMed && peMed > 3 ? Math.min(peMed, 25) : 18;
    const epsNow = m.eps !== null && m.eps > 0 ? m.eps : null;
    const scenarios: Scenario = {
      bear: epsNow === null ? null : round(epsNow * Math.pow(1 + Math.max(-0.05, gg / 2), 3) * (basePE * 0.7), 2),
      base: epsNow === null ? null : round(epsNow * Math.pow(1 + gg, 3) * basePE, 2),
      bull: epsNow === null ? null : round(epsNow * Math.pow(1 + gg + 0.02, 3) * (basePE * 1.3), 2),
      growth: growth === null ? null : round(growth, 4),
      multiple: round(basePE, 1),
    };
    const undervalued = m.pe !== null && m.pe > 0 && peMed !== null && m.pe < peMed * 0.8 && (m.roe === null ? false : m.roe > 0.12) && m.fcf !== null && m.fcf > 0 && (m.debtToEquity === null ? true : m.debtToEquity < 2);

    const thesis: string[] = [];
    thesis.push('Czym zajmuje się spółka: ' + r.def.description);
    const taniej = m.pe !== null && peMed !== null && m.pe < peMed * 0.9;
    const drozej = m.pe !== null && peMed !== null && m.pe > peMed * 1.2;
    thesis.push('Wycena: P/E ' + numS(m.pe) + ' (mediana grupy ' + numS(peMed) + '), P/B ' + numS(m.pb) + ', FCF yield ' + pctS(m.fcfYield) + '. ' +
      (taniej ? 'Spółka jest tańsza niż przeciętna w grupie — płacisz mniej za każdą złotówkę zysku.' :
        drozej ? 'Spółka jest droższa od przeciętnej — rynek wycenia jej przyszły wzrost ponad standard, więc rozczarowanie może mocno uderzyć w cenę.' :
        'Wycena jest zbliżona do przeciętnej w grupie.'));
    thesis.push('Jakość biznesu: ROE ' + pctS(m.roe) + ', marża netto ' + pctS(m.netMargin) + ', zadłużenie ' + numS(m.debtToEquity) + '× kapitału. ' +
      ((m.roe !== null && m.roe > 0.2) ? 'ROE powyżej 20% oznacza, że firma bardzo efektywnie pomnaża kapitał. ' : '') +
      ((m.debtToEquity !== null && m.debtToEquity > 2) ? 'Zadłużenie jest podwyższone — to zwiększa ryzyko w trudnym otoczeniu.' : ''));
    const wzrostTxt = (m.revCagr3 === null && m.epsCagr3 === null)
      ? 'Perspektywy wzrostu: za mało danych w raportach 10-K, by policzyć 3-letnie tempo wzrostu.'
      : 'Perspektywy wzrostu: przychody rosły średnio ' + (m.revCagr3 === null ? '—' : pctS(m.revCagr3)) + ' rocznie, a zysk na akcję ' + (m.epsCagr3 === null ? '—' : pctS(m.epsCagr3)) + ' rocznie (dane z 3 lat). ';
    thesis.push(wzrostTxt +
      ((m.epsCagr3 !== null && m.epsCagr3 > 0.1) ? 'To tempo powyżej inflacji — biznes realnie się rozwija.' : 'Wzrost jest umiarkowany, więc liczy się głównie stabilność.'));
    thesis.push('Scenariusze na 3 lata: pesymistyczny ' + numS(scenarios.bear, 2) + ' / bazowy ' + numS(scenarios.base, 2) + ' / optymistyczny ' + numS(scenarios.bull, 2) + '. To wyliczenie (zysk na akcję × mnożnik), a nie prognoza ceny.');
    if (undervalued) { thesis.push('Flaga: spółka wygląda na NIEDOSZACOWANĄ — jest tania względem grupy, a fundamenty ma dobre.'); }

    const risks: string[] = [];
    if (m.pe !== null && peMed !== null && m.pe > peMed * 1.4) { risks.push('Wysoka wycena: P/E wyraźnie powyżej mediany grupy — cena może mocno spaść, jeśli oczekiwania co do wzrostu osłabną.'); }
    if (m.debtToEquity !== null && m.debtToEquity > 2) { risks.push('Podwyższone zadłużenie: przy wzroście stóp procentowych koszty finansowania rosną, a zysk maleje.'); }
    if (m.fcf !== null && m.fcf <= 0) { risks.push('Ujemny wolny przepływ pieniężny (FCF): firma wydaje więcej, niż zarabia operacyjnie — może potrzebować finansowania zewnętrznego.'); }
    if (r.vol !== null && r.vol > 0.4) { risks.push('Wysoka zmienność (ponad 40% rocznie): możliwe głębokie, chwilowe obsunięcia kapitału.'); }
    if (r.trend === 'down') { risks.push('Cena poniżej średniej 50-dniowej: krótkoterminowy trend jest spadkowy — dla inwestora długoterminowego to nie wyrok, ale warto obserwować.'); }
    if (!risks.length) { risks.push('W danych nie ma sygnałów ostrzegawczych — ale to nie oznacza braku ryzyka rynkowego.'); }

    return {
      ticker: r.def.ticker, name: r.def.name, sector: r.def.sector, description: r.def.description,
      price: r.price === null ? null : round(r.price, 2), vol: r.vol === null ? null : round(r.vol, 4), trend: r.trend,
      metrics: m, score: round(score, 3), rank: 0, undervalued,
      quality: qz[i] === null ? null : round(qz[i] as number, 2), growth: gz[i] === null ? null : round(gz[i] as number, 2), value: vz[i] === null ? null : round(vz[i] as number, 2),
      beta: r.beta === null ? null : round(r.beta, 2),
      maxDD: r.mdd === null ? null : round(r.mdd, 4),
      sharpe: r.sharpe === null ? null : round(r.sharpe, 2),
      sortino: r.sortino === null ? null : round(r.sortino, 2),
      pePercentile: r.pePercentile === null ? null : round(r.pePercentile, 2),
      tier: '', weight: null,
      scenarios, thesis, risks,
    };
  });

  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });

  // --- Rekomendacje i wagi portfela ---
  for (const r of rows) {
    const roe = r.metrics.roe === null ? 0 : (r.metrics.roe as number);
    const tanio = r.pePercentile === null ? true : (r.pePercentile as number) < 0.85;
    r.tier = (r.score >= 1.0 && roe > 0.15 && tanio) ? 'Kupuj' : (r.score >= 0.3 ? 'Akumuluj' : (r.score >= -0.4 ? 'Obserwuj' : 'Unikaj'));
  }
  const picks = rows.filter((r) => r.tier === 'Kupuj' || r.tier === 'Akumuluj');
  const rawW = picks.map((r) => Math.max(0.05, r.score));
  const sumRaw = rawW.reduce((s, x) => s + x, 0) || 1;
  // Wagi w CZESCI AKCYJNEJ: proporcjonalne do wyniku, max 30% na spolke.
  // (Poprzedni limit 8% + normalizacja splaszczal wszystkie wagi do 20%.)
  picks.forEach((r, i) => { r.weight = Math.min(0.30, Math.max(0.02, rawW[i] / sumRaw)); });
  const sumW = picks.reduce((s, r) => s + (r.weight || 0), 0) || 1;
  picks.forEach((r) => { r.weight = (r.weight as number) / sumW; });
  // Twardy limit 30% rowniez PO normalizacji (nadwyzka wedruje do pozostalych).
  for (let iter = 0; iter < 5; iter++) {
    const over = picks.filter((r) => (r.weight as number) > 0.30);
    if (!over.length) { break; }
    const excess = over.reduce((s, r) => s + ((r.weight as number) - 0.30), 0);
    for (const r of over) { r.weight = 0.30; }
    const rest = picks.filter((r) => (r.weight as number) < 0.30);
    const restSum = rest.reduce((s, r) => s + (r.weight as number), 0) || 1;
    for (const r of rest) { r.weight = (r.weight as number) + excess * ((r.weight as number) / restSum); }
  }

  const wavg = (get: (r: DeepRow) => number | null): number | null => {
    let s = 0, w = 0;
    for (const r of picks) { const v = get(r); if (v !== null && Number.isFinite(v)) { s += v * (r.weight || 0); w += (r.weight || 0); } }
    return w > 0 ? s / w : null;
  };
  const portfolio = {
    holdings: picks.length,
    tickers: picks.map((r) => r.ticker),
    weightedPE: wavg((r) => r.metrics.pe),
    weightedROE: wavg((r) => r.metrics.roe),
    weightedBeta: wavg((r) => r.beta),
    weightedSharpe: wavg((r) => r.sharpe),
    expected3y: wavg((r) => (r.price && r.scenarios.base ? r.scenarios.base / r.price - 1 : null)),
    top3Weight: picks.slice(0, 3).reduce((s, r) => s + (r.weight || 0), 0),
    sectors: Array.from(new Set(picks.map((r) => r.sector))).length,
  };
  if (portfolio.weightedPE !== null) { portfolio.weightedPE = round(portfolio.weightedPE, 1); }
  if (portfolio.weightedROE !== null) { portfolio.weightedROE = round(portfolio.weightedROE, 4); }
  if (portfolio.weightedBeta !== null) { portfolio.weightedBeta = round(portfolio.weightedBeta, 2); }
  if (portfolio.weightedSharpe !== null) { portfolio.weightedSharpe = round(portfolio.weightedSharpe, 2); }
  if (portfolio.expected3y !== null) { portfolio.expected3y = round(portfolio.expected3y, 4); }
  portfolio.top3Weight = round(portfolio.top3Weight, 4);

  const assumptions: string[] = [
    'Horyzont: 3-5 lat. Portfel akcyjny; gotówka/obligacje dobierane do tolerancji ryzyka (poza modelem).',
    'Wagi: proporcjonalne do wyniku w części akcyjnej, max 30% na spółkę; suma wag = 100% części akcyjnej (zwykle 60-80% całego portfela; reszta to obligacje i gotówka).',
    'Beta liczona względem S&P 500 (SPY) z 5 lat; Sharpe/Sortino przy stopie wolnej od ryzyka 0%.',
    'Percentyl P/E: gdzie obecna wycena wypada na tle historycznych wycen tej samej spółki (0% = najtaniej kiedykolwiek, 100% = najdrożej).',
    'Scenariusze i oczekiwany zwrot to matematyka na założeniach (EPS × mnożnik), nie prognoza.',
  ];
  const buy = rows.slice(0, 5).map((r) => r.ticker);
  const undervalued = rows.filter((r) => r.undervalued).map((r) => r.ticker);
  if (!peMed) { notes.push('Za malo danych o wycenie, by policzyc mediane grupy.'); }
  const niepelne = rows.filter((r) => r.metrics.pe === null).map((r) => r.ticker);
  if (niepelne.length) { notes.push('Niekompletne dane fundamentalne w SEC (widoczne jako "—"): ' + niepelne.join(', ') + '. Nie wplywaja na mediane wyceny.'); }
  notes.push('Dane fundamentalne: SEC EDGAR (raporty 10-K), ceny: Yahoo/Stooq. Fundamenty odswiezane co 7 dni, ceny co ~10 min.');
  notes.push('Scenariusze to prosta matematyka (EPS x mnoznik), nie prognoza ceny ani obietnica zysku.');

  return { asOf: to, glossary: GLOSSARY, portfolio, assumptions, rows, buy, undervalued, notes, disclaimer: 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna. Nie jestem licencjonowanym doradca.' };
}
