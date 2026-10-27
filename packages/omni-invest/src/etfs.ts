import { InvestService } from './service.js';
import { metricsFromBars, InstrumentMetrics } from './overview.js';
import { daysAgo, mapLimit, todayIso } from './util.js';

export interface EtfDef { ticker: string; name: string; exchange: string; isin?: string; note?: string }
export interface EtfGroup { id: string; name: string; description: string; items: EtfDef[] }

export const ETF_GROUPS: EtfGroup[] = [
  {
    id: 'core',
    name: 'Fundamenty portfela (indeksy globalne)',
    description: 'Trzon inwestycji długoterminowej: szeroka dywersyfikacja, niskie koszty, najmniejsza potrzeba pilnowania.',
    items: [
      { ticker: 'CSPX.L', name: 'iShares Core S&P 500 UCITS ETF', exchange: 'LSE (USD)', isin: 'IE00B5BMR087', note: 'S&P 500 — 500 największych spółek USA. Rdzeń portfela: szeroka ekspozycja na największą gospodarkę świata. Ryzyko: duży udział technologii i USA.' },
      { ticker: 'IWDA.AS', name: 'iShares Core MSCI World UCITS ETF', exchange: 'Euronext Amsterdam', isin: 'IE00B4L5Y983', note: 'MSCI World — około 1400 spółek z rynków rozwiniętych. Najszersza baza portfela, najmniejsza zależność od jednego kraju. Ryzyko: brak rynków wschodzących.' },
      { ticker: 'CNDX.L', name: 'iShares Nasdaq 100 UCITS ETF', exchange: 'LSE (USD)', isin: 'IE00B53SZB19', note: 'Nasdaq 100 — 100 największych spółek technologicznych. Wyższy potencjał wzrostu, ale wyraźnie wyższa zmienność niż S&P 500.' },
    ],
  },
  {
    id: 'china',
    name: 'Chiny (spółki chińskie przez iShares)',
    description: 'Ekspozycja na Chiny: szeroki rynek oraz największe spółki (w tym państwowe). To pozycja o podwyższonym ryzyku, nie rdzeń portfela.',
    items: [
      { ticker: 'MCHI', name: 'iShares MSCI China ETF', exchange: 'NASDAQ (USD)', note: 'MSCI China — szeroki koszyk spółek chińskich notowanych w Hongkongu i USA. Ryzyko: regulacje, polityka, ograniczona przejrzystość.' },
      { ticker: 'FXI', name: 'iShares China Large-Cap ETF', exchange: 'NYSE (USD)', note: 'Największe spółki chińskie (blue chipy, w tym państwowe). Bardziej skoncentrowany niż MCHI — większe wahania przy decyzjach politycznych.' },
    ],
  },
  {
    id: 'satellite',
    name: 'Dodatki: regiony, sektory, czynniki',
    description: 'Uzupełnienie rdzenia. Większy potencjał, ale też większa zmienność — zwykle mniejsza część portfela.',
    items: [
      { ticker: 'EIMI.L', name: 'iShares Core MSCI EM IMI UCITS ETF', exchange: 'LSE (USD)', isin: 'IE00BKM4GZ66', note: 'Rynki wschodzące: Chiny, Indie, Brazylia i inne. Wyższy potencjał wzrostu, wyższe ryzyko i większe wahania.' },
      { ticker: 'IMEU.L', name: 'iShares Core MSCI Europe UCITS ETF', exchange: 'LSE (EUR)', note: 'Europa — szeroki rynek. Dywersyfikuje portfel poza USA, często przy niższych wycenach.' },
      { ticker: 'IUIT.L', name: 'iShares S&P 500 Information Technology Sector UCITS ETF', exchange: 'LSE (USD)', note: 'Sektor technologiczny USA. Wąska ekspozycja: wysoki potencjał, ale duża koncentracja w kilku spółkach.' },
      { ticker: 'IWQU.L', name: 'iShares MSCI World Quality Factor UCITS ETF', exchange: 'LSE (USD)', note: 'Spółki o wysokiej jakości: rentowne, mało zadłużone. Zwykle stabilniejsze w słabszych okresach.' },
    ],
  },
  {
    id: 'defensive',
    name: 'Ochrona i dywersyfikacja',
    description: 'Elementy stabilizujące: mają chronić portfel w kryzysie, a nie zarabiać najwięcej.',
    items: [
      { ticker: 'IGLN.L', name: 'iShares Physical Gold ETC', exchange: 'LSE (USD)', isin: 'IE00B4ND3602', note: 'Złoto fizyczne. Ochrona przed inflacją i kryzysem; nie wypłaca dywidendy, więc długoterminowo bywa wolniejsze niż akcje.' },
      { ticker: 'AGGG.L', name: 'iShares Core Global Aggregate Bond UCITS ETF', exchange: 'LSE (USD)', note: 'Obligacje globalne. Stabilizują portfel i ograniczają obsunięcia; przy wyższych stopach procentowych mogą tracić.' },
    ],
  },
];

export interface EtfRow extends EtfDef { group: string; metrics: InstrumentMetrics }
export interface EtfResult { asOf: string; groups: Array<{ id: string; name: string; description: string; rows: EtfRow[] }>; notes: string[]; disclaimer: string }

export async function runEtfs(service: InvestService): Promise<EtfResult> {
  const from = daysAgo(420);
  const to = todayIso();
  const notes: string[] = [];
  const groups: EtfResult['groups'] = [];
  for (const g of ETF_GROUPS) {
    const rows = await mapLimit(g.items, 4, async (d) => {
      try {
        const bars = await service.price.getDailyBars(d.ticker, from, to);
        if (!bars.length) { notes.push('Brak danych: ' + d.name + ' (' + d.ticker + ')'); }
        return { ...d, group: g.id, metrics: metricsFromBars(bars) };
      } catch (e) {
        notes.push('Błąd danych: ' + d.name);
        return { ...d, group: g.id, metrics: metricsFromBars([]) };
      }
    });
    groups.push({ id: g.id, name: g.name, description: g.description, rows });
  }
  notes.push('Ceny są w walucie notowania danego ETF (USD, GBp lub EUR) — nie porównuj ich wprost między giełdami.');
  notes.push('Tickery różnią się w zależności od giełdy (LSE / NASDAQ / Euronext). ISIN sprawdź u brokera przed zakupem.');
  notes.push('Dane: Yahoo Finance (fallback Stooq), mogą być opóźnione.');
  return { asOf: to, groups, notes, disclaimer: 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.' };
}
