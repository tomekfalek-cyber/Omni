import { InvestService } from './service.js';
import { metricsFromBars, InstrumentMetrics } from './overview.js';
import { daysAgo, mapLimit, todayIso } from './util.js';

export interface EtfDef { ticker: string; name: string; exchange: string; isin?: string; note?: string }
export interface EtfGroup { id: string; name: string; description: string; items: EtfDef[] }

export const ETF_GROUPS: EtfGroup[] = [
  {
    id: 'core',
    name: 'Fundamenty portfela (indeksy globalne)',
    description: 'Trzon dlugoterminowy: szeroka dywersyfikacja, niskie koszty.',
    items: [
      { ticker: 'CSPX.L', name: 'iShares Core S&P 500 UCITS ETF', exchange: 'LSE (USD)', isin: 'IE00B5BMR087', note: 'S&P 500 - 500 najwiekszych spolek USA' },
      { ticker: 'IWDA.AS', name: 'iShares Core MSCI World UCITS ETF', exchange: 'Euronext Amsterdam', isin: 'IE00B4L5Y983', note: 'MSCI World - ~1400 spolek z rynkow rozwinietych' },
      { ticker: 'CNDX.L', name: 'iShares Nasdaq 100 UCITS ETF', exchange: 'LSE (USD)', isin: 'IE00B53SZB19', note: 'Nasdaq 100 - 100 najwiekszych spolek technologicznych' },
    ],
  },
  {
    id: 'china',
    name: 'Chiny (spolki chinskie przez iShares)',
    description: 'Ekspozycja na Chiny: szeroki rynek oraz duze spoleki panstwowe.',
    items: [
      { ticker: 'MCHI', name: 'iShares MSCI China ETF', exchange: 'NASDAQ (USD)', note: 'MSCI China - szeroki koszyk spolek chinskich (HK/US)' },
      { ticker: 'FXI', name: 'iShares China Large-Cap ETF', exchange: 'NYSE (USD)', note: 'Duze spolki chinskie (blue chipy, m.in. panstwowe)' },
    ],
  },
  {
    id: 'satellite',
    name: 'Dodatki: regiony, sektory, czynniki',
    description: 'Uzupelnienie rdzenia - wieksze ryzyko, wiekszy potencjal.',
    items: [
      { ticker: 'EIMI.L', name: 'iShares Core MSCI EM IMI UCITS ETF', exchange: 'LSE (USD)', isin: 'IE00BKM4GZ66', note: 'Rynki wschodzace - Chiny, Indie, Brazylia itd.' },
      { ticker: 'IMEU.L', name: 'iShares Core MSCI Europe UCITS ETF', exchange: 'LSE (EUR)', note: 'Europa - szeroki rynek' },
      { ticker: 'IUIT.L', name: 'iShares S&P 500 Information Technology Sector UCITS ETF', exchange: 'LSE (USD)', note: 'Sektor technologiczny USA - waska ekspozycja' },
      { ticker: 'IWQU.L', name: 'iShares MSCI World Quality Factor UCITS ETF', exchange: 'LSE (USD)', note: 'Spolki o wysokiej jakosci (rentownosc, niskie zadluzenie)' },
    ],
  },
  {
    id: 'defensive',
    name: 'Ochrona i dywersyfikacja',
    description: 'Elementy stabilizujace portfel.',
    items: [
      { ticker: 'IGLN.L', name: 'iShares Physical Gold ETC', exchange: 'LSE (USD)', isin: 'IE00B4ND3602', note: 'Zloto fizyczne w formie ETC' },
      { ticker: 'AGGG.L', name: 'iShares Core Global Aggregate Bond UCITS ETF', exchange: 'LSE (USD)', note: 'Obligacje globalne - czesc obronna portfela' },
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
        notes.push('Blad danych: ' + d.name);
        return { ...d, group: g.id, metrics: metricsFromBars([]) };
      }
    });
    groups.push({ id: g.id, name: g.name, description: g.description, rows });
  }
  notes.push('Ceny w walucie notowania danego ETF (USD/GBp/EUR) - nie porownuj ich wprost miedzy rynkami.');
  notes.push('Tickery roznia sie w zaleznosci od gieldy (LSE/NASDAQ/Euronext). ISIN sprawdz u brokera przed zakupem.');
  notes.push('Dane: Yahoo/Stooq, moga byc opoznione.');
  return { asOf: to, groups, notes, disclaimer: 'To analiza edukacyjna, nie personalna rekomendacja inwestycyjna.' };
}
