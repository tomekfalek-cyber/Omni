import { ToolDefinition } from 'omni-core/types.js';
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

const PY = path.join(os.homedir(), '.omni', 'venv', 'bin', 'python');
const SEARCH_PY = path.join(os.homedir(), '.omni', 'bin', 'websearch.py');

/** Narzedzia internetowe - bez zadnych kluczy API. */
export class WebTools {
  private readonly MAX_BYTES = 60_000;

  public getDefinitions(): ToolDefinition[] {
    return [
      { name: 'web_search', description: 'Szuka informacji w internecie. Zwraca tytuly, adresy i opisy.', parameters: { query: 'string' }, requiresApproval: false, timeoutMs: 35000, maxOutputBytes: this.MAX_BYTES },
      { name: 'web_fetch', description: 'Pobiera strone internetowa jako czysty tekst.', parameters: { url: 'string' }, requiresApproval: false, timeoutMs: 30000, maxOutputBytes: this.MAX_BYTES },
      { name: 'crypto_price', description: 'Aktualny kurs kryptowalut w USD i PLN.', parameters: { coins: 'string' }, requiresApproval: false, timeoutMs: 20000, maxOutputBytes: 4000 },
      { name: 'news', description: 'Najnowsze wiadomosci na podany temat.', parameters: { query: 'string' }, requiresApproval: false, timeoutMs: 25000, maxOutputBytes: 8000 }
    ];
  }

  private between(text: string, start: string, end: string): string {
    const i = text.indexOf(start);
    if (i < 0) { return ''; }
    const j = text.indexOf(end, i + start.length);
    if (j < 0) { return ''; }
    return text.slice(i + start.length, j);
  }

  private cleanText(raw: string): string {
    let s = String(raw || '');
    s = s.split('<![CDATA[').join('').split(']]>').join('');
    s = s.replace(new RegExp('<[^>]*>', 'g'), ' ');
    s = s.split('&amp;').join('&').split('&quot;').join('"').split('&lt;').join('<').split('&gt;').join('>').split('&#39;').join("'").split('&nbsp;').join(' ');
    return s.replace(new RegExp('[ \t]+', 'g'), ' ').trim();
  }

  private stripHtml(html: string): string {
    let text = String(html || '');
    text = text.split('<script').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('</script') + 9))).join(' ');
    text = text.split('<style').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('</style') + 8))).join(' ');
    text = text.replace(new RegExp('<[^>]*>', 'g'), ' ');
    text = text.split('&nbsp;').join(' ').split('&amp;').join('&').split('&quot;').join('"');
    text = text.split('&lt;').join('<').split('&gt;').join('>').split('&#39;').join("'");
    text = text.replace(new RegExp('[ \\t]+', 'g'), ' ');
    text = text.replace(new RegExp('\\n{3,}', 'g'), String.fromCharCode(10) + String.fromCharCode(10));
    return text.trim();
  }

  private async getText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
    });
    return await res.text();
  }

  private async ddgs(query: string): Promise<WebResult[]> {
    return await new Promise<WebResult[]>((resolve) => {
      execFile(PY, [SEARCH_PY, query], { timeout: 25000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error || !stdout) { resolve([]); return; }
        try {
          const data = JSON.parse(String(stdout));
          if (!Array.isArray(data)) { resolve([]); return; }
          resolve(data.map((r: any) => ({ title: String(r.title || ''), url: String(r.url || ''), snippet: String(r.snippet || '') })));
        } catch (e) { resolve([]); }
      });
    });
  }

  private async ddgInstant(query: string): Promise<WebResult[]> {
    const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=0';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data: any = await res.json();
    const out: WebResult[] = [];
    if (data.AbstractText) { out.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText }); }
    for (const r of (data.Results || [])) { out.push({ title: r.Text || '', url: r.FirstURL || '', snippet: r.Text || '' }); }
    for (const topic of (data.RelatedTopics || [])) {
      if (topic.Topics) {
        for (const sub of topic.Topics) { out.push({ title: sub.Text || '', url: sub.FirstURL || '', snippet: sub.Text || '' }); }
      } else {
        out.push({ title: topic.Text || '', url: topic.FirstURL || '', snippet: topic.Text || '' });
      }
    }
    return out;
  }

  private async wikipedia(query: string): Promise<WebResult[]> {
    const out: WebResult[] = [];
    for (const lang of ['pl', 'en']) {
      try {
        const url = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
          encodeURIComponent(query) + '&format=json&srlimit=3';
        const res = await fetch(url, { headers: { 'User-Agent': 'OmniBot/1.2' } });
        const data: any = await res.json();
        const items = (data.query && data.query.search) || [];
        for (const item of items) {
          out.push({
            title: item.title,
            url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(String(item.title).split(' ').join('_')),
            snippet: this.cleanText(String(item.snippet || '')),
          });
        }
      } catch (error) { }
    }
    return out;
  }

  private async googleNews(query: string, limit: number): Promise<WebResult[]> {
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=pl&gl=PL&ceid=PL:pl';
    const xml = await this.getText(url);
    const out: WebResult[] = [];
    const parts = xml.split('<item>');
    for (let i = 1; i < parts.length && out.length < limit; i++) {
      const chunk = parts[i];
      const title = this.cleanText(this.between(chunk, '<title>', '</title>'));
      const link = this.cleanText(this.between(chunk, '<link>', '</link>'));
      const date = this.cleanText(this.between(chunk, '<pubDate>', '</pubDate>'));
      if (title) { out.push({ title: title, url: link, snippet: date }); }
    }
    return out;
  }

  private async recipesFrom(query: string): Promise<WebResult[]> {
    try {
      const url = 'https://www.kwestiasmaku.com/szukaj?query=' + encodeURIComponent(query);
      const html = await this.getText(url);
      const out: WebResult[] = [];
      const needle = 'href="/przepisy/';
      let idx = html.indexOf(needle);
      while (idx !== -1 && out.length < 5) {
        const start = idx + 'href="'.length;
        const end = html.indexOf('"', start);
        if (end < 0) { break; }
        const href = html.slice(start, end);
        const close = html.indexOf('>', end);
        const text = close > 0 ? this.cleanText(html.slice(close + 1, close + 160)) : '';
        if (href.indexOf('/przepisy/') === 0 && text && text.length > 2) {
          out.push({ title: text.slice(0, 100), url: 'https://www.kwestiasmaku.com' + href, snippet: 'przepis' });
        }
        idx = html.indexOf(needle, end);
      }
      return out;
    } catch (error) { return []; }
  }

  public async search(args: { query: string }): Promise<string> {
    const query = String((args && args.query) || '').trim();
    if (!query) { throw new Error('Podaj zapytanie.'); }
    const lower = query.toLowerCase();
    let results: WebResult[] = [];

    try { results = results.concat(await this.ddgs(query)); } catch (error) { }
    if (results.length < 3) { try { results = results.concat(await this.ddgInstant(query)); } catch (error) { } }
    if (results.length < 3) { try { results = results.concat(await this.wikipedia(query)); } catch (error) { } }
    try { results = results.concat(await this.googleNews(query, 4)); } catch (error) { }
    if (lower.indexOf('przepis') !== -1 || lower.indexOf('jak zrobic') !== -1 || lower.indexOf('jak ugotowac') !== -1 || lower.indexOf('recipe') !== -1) {
      try { results = results.concat(await this.recipesFrom(query.split(' ').pop() || query)); } catch (error) { }
    }

    const seen: string[] = [];
    const lines: string[] = [];
    for (const r of results) {
      const title = this.cleanText(r.title).slice(0, 130);
      const key = (title + '|' + r.url).slice(0, 110);
      if (!title || seen.indexOf(key) !== -1) { continue; }
      seen.push(key);
      lines.push(lines.length + 1 + '. ' + title + String.fromCharCode(10) + '   ' + r.url + String.fromCharCode(10) + '   ' + this.cleanText(r.snippet).slice(0, 220));
      if (lines.length >= 8) { break; }
    }
    if (!lines.length) { return 'Brak wynikow. Sprobuj inaczej sformulowac pytanie albo uzyj narzedzia news.'; }
    return lines.join(String.fromCharCode(10) + String.fromCharCode(10));
  }

  public async fetchUrl(args: { url: string }): Promise<string> {
    let url = String((args && args.url) || '').trim();
    if (!url) { throw new Error('Podaj adres.'); }
    if (url.indexOf('http') !== 0) { url = 'https://' + url; }
    const html = await this.getText(url);
    return this.stripHtml(html).slice(0, this.MAX_BYTES);
  }

  private coinId(name: string): string {
    const n = String(name || '').toLowerCase().trim();
    const map: Record<string, string> = {
      bitcoin: 'bitcoin', btc: 'bitcoin', bitcoina: 'bitcoin', bitcoiny: 'bitcoin',
      ethereum: 'ethereum', eth: 'ethereum', ether: 'ethereum', ethereum2: 'ethereum',
      solana: 'solana', sol: 'solana', dogecoin: 'dogecoin', doge: 'dogecoin',
      cardano: 'cardano', ada: 'cardano', ripple: 'ripple', xrp: 'ripple',
      litecoin: 'litecoin', ltc: 'litecoin', polkadot: 'polkadot', dot: 'polkadot',
      bnb: 'binancecoin', binance: 'binancecoin', tether: 'tether', usdt: 'tether',
      tron: 'tron', trx: 'tron', shiba: 'shiba-inu', monero: 'monero', xmr: 'monero'
    };
    return map[n] || n;
  }

  public async crypto(args: { coins: string }): Promise<string> {
    const raw = String((args && args.coins) || '').trim();
    const names = raw ? raw.split(',').map((x) => x.trim()).filter((x) => x) : ['bitcoin', 'ethereum', 'solana', 'dogecoin'];
    const ids = names.map((n) => this.coinId(n)).slice(0, 8);
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=usd,pln&include_24hr_change=true';
    const res = await fetch(url, { headers: { 'User-Agent': 'OmniBot/1.2' } });
    const data: any = await res.json();
    const lines: string[] = [];
    for (const id of ids) {
      const row = data[id];
      if (!row) { continue; }
      const chg = (row.usd_24h_change === undefined || row.usd_24h_change === null) ? '' : (' (24h: ' + Number(row.usd_24h_change).toFixed(2) + '%)');
      lines.push(id + ': ' + row.usd + ' USD / ' + row.pln + ' PLN' + chg);
    }
    if (!lines.length) { return 'Nie udalo sie pobrac kursu dla: ' + ids.join(', '); }
    return 'Kursy kryptowalut (zrodlo: CoinGecko):' + String.fromCharCode(10) + lines.join(String.fromCharCode(10));
  }

  public async news(args: { query: string }): Promise<string> {
    const query = String((args && args.query) || 'Polska').trim() || 'Polska';
    const items = await this.googleNews(query, 8);
    if (!items.length) { return 'Brak wiadomosci dla: ' + query; }
    const lines: string[] = [];
    for (let i = 0; i < items.length; i++) {
      lines.push((i + 1) + '. ' + items[i].title + String.fromCharCode(10) + '   ' + items[i].url + String.fromCharCode(10) + '   ' + items[i].snippet);
    }
    return 'Najnowsze wiadomosci dla: ' + query + String.fromCharCode(10) + lines.join(String.fromCharCode(10) + String.fromCharCode(10));
  }
}
