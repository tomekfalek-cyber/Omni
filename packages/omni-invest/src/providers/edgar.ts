import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const UA = 'Omni Invest research (local use)';
const MAP_TTL = 7 * 24 * 3600 * 1000;
const CONCEPT_TTL = 7 * 24 * 3600 * 1000;

/** SEC EDGAR - darmowe dane fundamentalne z raportow 10-K. Cache na dysku (7 dni). */
export class EdgarProvider {
  private dir: string;
  private mapFile: string;
  private mapCache: Record<string, string> | null = null;

  constructor(dir?: string) {
    this.dir = dir || path.join(os.homedir(), '.omni', 'invest', 'edgar');
    this.mapFile = path.join(this.dir, 'tickers.json');
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) { }
  }

  private async getJson(url: string): Promise<any> {
    let lastErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (res.ok) { return await res.json(); }
      lastErr = 'EDGAR HTTP ' + res.status;
      // 429/5xx: odczekaj i ponow (SEC limituje tempo).
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      break;
    }
    throw new Error(lastErr || 'EDGAR error');
  }

  public async cikFor(ticker: string): Promise<string | null> {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) { return null; }
    if (!this.mapCache) {
      try {
        const st = fs.statSync(this.mapFile);
        if (Date.now() - st.mtimeMs < MAP_TTL) { this.mapCache = JSON.parse(fs.readFileSync(this.mapFile, 'utf8')); }
      } catch (e) { }
      if (!this.mapCache) {
        const raw: any = await this.getJson('https://www.sec.gov/files/company_tickers.json');
        const map: Record<string, string> = {};
        for (const k of Object.keys(raw || {})) {
          const row = raw[k];
          if (row && row.ticker && row.cik_str) { map[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, '0'); }
        }
        this.mapCache = map;
        try { fs.writeFileSync(this.mapFile, JSON.stringify(map), 'utf8'); } catch (e) { }
      }
    }
    return this.mapCache[t] || null;
  }

  public async concept(ticker: string, tag: string): Promise<any | null> {
    const cik = await this.cikFor(ticker);
    if (!cik) { return null; }
    const f = path.join(this.dir, String(ticker).toUpperCase() + '_' + tag + '.json');
    try {
      const st = fs.statSync(f);
      if (Date.now() - st.mtimeMs < CONCEPT_TTL) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    } catch (e) { }
    try {
      const data = await this.getJson('https://data.sec.gov/api/xbrl/companyconcept/CIK' + cik + '/us-gaap/' + tag + '.json');
      try { fs.writeFileSync(f, JSON.stringify(data), 'utf8'); } catch (e) { }
      await new Promise((r) => setTimeout(r, 120));
      return data;
    } catch (e) { return null; }
  }
}
