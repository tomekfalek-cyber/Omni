import { ToolDefinition } from 'omni-core/types.js';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

/** Narzedzia internetowe - bez zadnych kluczy API. */
export class WebTools {
  private readonly MAX_BYTES = 60_000;

  public getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'web_search',
        description: 'Wyszukuje informacje w internecie. Zwraca liste wynikow (tytul, adres, opis).',
        parameters: { query: 'string' },
        requiresApproval: false,
        timeoutMs: 25000,
        maxOutputBytes: this.MAX_BYTES
      },
      {
        name: 'web_fetch',
        description: 'Pobiera strone internetowa pod danym adresem i zwraca jej tresc jako czysty tekst.',
        parameters: { url: 'string' },
        requiresApproval: false,
        timeoutMs: 30000,
        maxOutputBytes: this.MAX_BYTES
      }
    ];
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

  private async ddgInstant(query: string): Promise<WebResult[]> {
    const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=0';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data: any = await res.json();
    const out: WebResult[] = [];
    if (data.AbstractText) {
      out.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText });
    }
    for (const r of (data.Results || [])) {
      out.push({ title: r.Text || '', url: r.FirstURL || '', snippet: r.Text || '' });
    }
    for (const topic of (data.RelatedTopics || [])) {
      if (topic.Topics) {
        for (const sub of topic.Topics) {
          out.push({ title: sub.Text || '', url: sub.FirstURL || '', snippet: sub.Text || '' });
        }
      } else {
        out.push({ title: topic.Text || '', url: topic.FirstURL || '', snippet: topic.Text || '' });
      }
    }
    return out;
  }

  private async wikipedia(query: string): Promise<WebResult[]> {
    const out: WebResult[] = [];
    const langs = ['pl', 'en'];
    for (const lang of langs) {
      try {
        const url = 'https://' + lang + '.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
          encodeURIComponent(query) + '&format=json&srlimit=4';
        const res = await fetch(url, { headers: { 'User-Agent': 'OmniBot/1.1' } });
        const data: any = await res.json();
        const items = (data.query && data.query.search) || [];
        for (const item of items) {
          out.push({
            title: item.title,
            url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(String(item.title).split(' ').join('_')),
            snippet: this.stripHtml(String(item.snippet || '')),
          });
        }
      } catch (error) {
        // ignoruj jezyk, probuj dalej
      }
    }
    return out;
  }

  public async search(args: { query: string }): Promise<string> {
    const query = String((args && args.query) || '').trim();
    if (!query) { throw new Error('Podaj zapytanie.'); }
    const errors: string[] = [];
    let results: WebResult[] = [];
    try {
      results = await this.ddgInstant(query);
    } catch (error: any) {
      errors.push('ddg: ' + error.message);
    }
    if (results.length < 3) {
      try {
        const wiki = await this.wikipedia(query);
        results = results.concat(wiki);
      } catch (error: any) {
        errors.push('wikipedia: ' + error.message);
      }
    }
    if (!results.length) {
      throw new Error('Brak wynikow. ' + errors.join(' | '));
    }
    const seen: string[] = [];
    const lines: string[] = [];
    for (const r of results) {
      const key = (r.title + '|' + r.url).slice(0, 120);
      if (seen.indexOf(key) !== -1) { continue; }
      seen.push(key);
      const title = this.stripHtml(r.title).slice(0, 120);
      const snippet = this.stripHtml(r.snippet).slice(0, 240);
      lines.push(lines.length + 1 + '. ' + title + String.fromCharCode(10) + '   ' + r.url + String.fromCharCode(10) + '   ' + snippet);
      if (lines.length >= 8) { break; }
    }
    return lines.join(String.fromCharCode(10) + String.fromCharCode(10));
  }

  public async fetchUrl(args: { url: string }): Promise<string> {
    let url = String((args && args.url) || '').trim();
    if (!url) { throw new Error('Podaj adres.'); }
    if (url.indexOf('http') !== 0) { url = 'https://' + url; }
    const html = await this.getText(url);
    const text = this.stripHtml(html);
    return text.slice(0, this.MAX_BYTES);
  }
}
