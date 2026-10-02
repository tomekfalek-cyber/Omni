import { QwenProvider } from 'omni-core/providers/qwen-provider.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Task, Message, AgentRole, ToolCall } from 'omni-core/types.js';
import { OmniMemory } from 'omni-memory/memory.js';
import { ToolRegistry } from 'omni-tools/registry.js';
import { v4 as uuidv4 } from 'uuid';

export class SwarmManager {
  private planner: QwenProvider;
  private executor: QwenProvider;
  private reviewer: QwenProvider;
  private evolver: QwenProvider;
  private coder: QwenProvider;
  private memory: OmniMemory;
  public workspaceCwd: string = process.cwd();
  private tools: ToolRegistry;
  /** Wywolywane, gdy czat padnie na limicie/blędzie dostawcy (np. 429). */
  public onEngineFailure?: () => void;

  /** Prawda, gdy bot wlasnie wykonuje zadanie. */
  public busy = false;

  constructor() {
    const provider = (process.env.OMNI_LLM_PROVIDER as any) || 'ollama';
    // Konfigurowalne przez .env — domyślnie model mieszczący się na słabym sprzęcie.
    const defaultFlash = provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen/qwen-2.5-7b-instruct:free';
    const defaultPro = provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen/qwen-2.5-coder-32b-instruct:free';
    const modelFlash = process.env.OMNI_LLM_MODEL || defaultFlash;
    const modelPro = process.env.OMNI_LLM_MODEL_PRO || modelFlash;

    this.planner = new QwenProvider({ provider, model: modelFlash, temperature: 0.7, maxTokens: 2000 });
    this.executor = new QwenProvider({ provider, model: modelFlash, temperature: 0.3, maxTokens: 4000 });
    this.reviewer = new QwenProvider({ provider, model: modelPro, temperature: 0.1, maxTokens: 2000 });
    this.evolver = new QwenProvider({ provider, model: modelFlash, temperature: 0.8, maxTokens: 3000 });
    this.coder = new QwenProvider({ provider, model: process.env.OMNI_LLM_MODEL_CODER || modelPro, temperature: 0.2, maxTokens: 4000 });
    
    this.memory = new OmniMemory();
    this.tools = new ToolRegistry();
    this.registerMemoryTools();
    this.reconfigure();
  }

  /** Przebudowuje silniki po zmianie klucza, dostawcy lub modelu w panelu. */
  public reconfigure(): void {
    const provider = (process.env.OMNI_LLM_PROVIDER as any) || 'ollama';
    const defaultFlash = provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen/qwen-2.5-7b-instruct:free';
    const defaultPro = provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen/qwen-2.5-coder-32b-instruct:free';
    const modelFlash = process.env.OMNI_LLM_MODEL || defaultFlash;
    const modelPro = process.env.OMNI_LLM_MODEL_PRO || modelFlash;

    // Model pomocniczy (planer, reviewer, evolver) - mniejszy, zeby nie zjadac limitu tokenow.
    const defaultMini = provider === 'groq' ? 'openai/gpt-oss-20b' : modelFlash;
    const modelMini = process.env.OMNI_LLM_MODEL_MINI || defaultMini;

    this.planner = new QwenProvider({ provider, model: modelMini, temperature: 0.7, maxTokens: 700 });
    this.executor = new QwenProvider({ provider, model: modelFlash, temperature: 0.3, maxTokens: 1400 });
    this.reviewer = new QwenProvider({ provider, model: modelMini, temperature: 0.1, maxTokens: 400 });
    this.evolver = new QwenProvider({ provider, model: modelMini, temperature: 0.8, maxTokens: 500 });
    const defaultCoder = provider === 'groq' ? 'openai/gpt-oss-120b' : 'qwen/qwen3.8-27b:free';
    this.coder = new QwenProvider({ provider, model: process.env.OMNI_LLM_MODEL_CODER || defaultCoder, temperature: 0.2, maxTokens: 4000 });
  }

  /** Krotkie zapytanie testowe do aktualnie ustawionego silnika. */
  public async ping(prompt: string): Promise<string> {
    const messages: any = [
      { role: 'system', content: 'Odpowiadaj krotko i po polsku.' },
      { role: 'user', content: prompt },
    ];
    return this.executor.getCompletion(messages);
  }

  /** Zasady dzialania - wspolne dla wszystkich sciezek (jak u asystenta OpenClaw). */
  private behaviorRules(): string {
    const nl = String.fromCharCode(10);
    return [
      'ZASADY DZIALANIA (obowiazuja zawsze):',
      '1. Badz konkretny. Odpowiadaj po polsku, krotko i rzeczowo, bez wstepow typu swietne pytanie.',
      '2. Zanim odpowiesz o faktach, plikach, cenach, pogodzie albo stanie czegokolwiek - UZYJ NARZEDZIA i sprawdz. Nie zgaduj.',
      '3. Przy zadaniach wieloetapowych: najpierw krotko zaplanuj, potem wykonaj, na koncu SPRAWDZ wynik (uruchom test, odczytaj plik, sprawdz kod HTTP).',
      '4. Nigdy nie mow, ze cos zostalo zrobione, jesli nie masz dowodu (wynik komendy, sciezka pliku, kod HTTP). Brak dowodu = powiedz wprost, czego brakuje.',
      '5. Jesli narzedzie zawiedzie dwa razy, zmien podejscie i powiedz o tym. Nie powtarzaj tej samej nieudanej proby.',
      '6. Nie wymyslaj ograniczen, ktorych nie masz: masz internet, pamiec, narzedzia i dzisiejsza date. Jesli czegos nie mozesz - powiedz dokladnie czego i dlaczego.',
      '7. Praca lokalna jest DOZWOLONA i nie wymaga pytania: zapisuj pliki, uruchamiaj komendy i testy, commituj w lokalnym repo - po prostu to zrob i pokaz wynik. Pytaj TYLKO o dzialania na zewnatrz: wyslanie wiadomosci, publikacja, push do CUDZEGO repozytorium.',
      '8. Nie uruchamiaj destrukcyjnych komend bez zgody.',
      '9. Korzystaj z pamieci: najpierw sprawdz, co juz wiesz, potem zapisuj trwale ustalenia.',
      '10. Koncz zadanie: albo wynik z dowodem, albo konkretna przeszkoda. Nie koncz na samym planie.',
      '11. Formatuj czytelnie (naglowki, listy). Bez lania wody.',
      '12. Serwery i dlugo dzialajace procesy uruchamiaj ODLACZONE: setsid nohup node /sciezka/serwer.js > /home/openclaw/serwer.log 2>&1 &  - inaczej zginą razem z powloka narzedzia.',
      '13. Nie mow, ze cos dziala, dopoki tego nie sprawdziles komenda (np. curl -sS -m 5 http://127.0.0.1:PORT/). Nieudane sprawdzenie - powiedz o tym wprost.',
      '14. ZLOZONE ZADANIE ROZBIJ NA KROKI i wykonuj po kolei. Po kazdym kroku sprawdz wynik, zanim przejdziesz dalej.',
      '15. GDY NARZEDZIE ZWROCI BLAD - nie poddawaj sie. Przeanalizuj blad, zmien podejscie i sprobuj ponownie (do 3 razy). Dopiero po 3 nieudanych probach powiedz, ze sie nie udalo - i wyjasnij, co probowales.',
      '16. MYSL KROK PO KROKU: najpierw ustal, JAK sprawdzisz sukces, potem dzialaj, na koncu sprawdz. Nie zgaduj - sprawdzaj. To jest twoja najwazniejsza zasada.',
      '17. MASZ PLAN od planera. Wykonuj kroki planu PO KOLEI narzedziami. Zadanie konczysz DOPIERO po wykonaniu ostatniego kroku planu (weryfikacji). Nie pisz odpowiedzi koncowej przedwczesnie.',
      '18. PEWNOSC: jesli nie masz pewnosci co do faktu, napisz wprost "Nie mam pewnosci" i NAJPIERW sprawdz go narzedziem. Nigdy nie podawaj niepewnego faktu jako pewny.',
      '19. TDD (kod): przy pisaniu kodu NAJPIERW zaplanuj test, potem napisz kod, potem URUCHOM test i poprawiaj, az przejdzie. Nie koncz bez uruchomienia kodu.',
      '20. WERYFIKACJA KODU: przed oddaniem odpowiedzi o kodzie uruchom typecheck/lint/test (np. tsc --noEmit, npm test). Jesli nie mozesz - napisz wprost, co sprawdziles, a czego nie.',
    ].join(nl);
  }
  /** Sklada polskie znaki do ASCII (do dopasowywania slow kluczowych). */
  private foldPl(s: string): string {
    const map: any = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z', 'Ą': 'a', 'Ć': 'c', 'Ę': 'e', 'Ł': 'l', 'Ń': 'n', 'Ó': 'o', 'Ś': 's', 'Ź': 'z', 'Ż': 'z' };
    let out = '';
    for (const ch of String(s || '')) { out += (map[ch] !== undefined ? map[ch] : ch); }
    return out;
  }
  private registerMemoryTools() {
    this.tools.register({
      definition: {
        name: 'memory_save',
        description: 'Zapisuje trwala notatke w pamieci bota (fakt, preferencja, ustalenie).',
        parameters: { text: 'string' },
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 0,
      },
      execute: async (args: any) => {
        const text = String((args && args.text) || '').trim();
        if (!text) { throw new Error('Pusta notatka.'); }
        this.memory.saveFact('note_' + Date.now(), text);
        return 'Zapisano w pamieci: ' + text;
      },
    });
    this.tools.register({
      definition: {
        name: 'memory_search',
        description: 'Przeszukuje pamiec bota (wczesniejsze rozmowy i notatki).',
        parameters: { query: 'string' },
        requiresApproval: false,
        timeoutMs: 8000,
        maxOutputBytes: 20000,
      },
      execute: async (args: any) => {
        const query = String((args && args.query) || '').trim();
        if (!query) { throw new Error('Podaj zapytanie.'); }
        const hits: any[] = this.memory.search(query, 8) as any;
        if (!hits.length) { return 'Brak wynikow w pamieci.'; }
        return hits.map((h: any) => '- [' + h.role + '] ' + String(h.content).slice(0, 300)).join(String.fromCharCode(10));
      },
    });
    this.tools.register({
      definition: {
        name: 'skill_save',
        description: 'Zapisuje procedure (skill) do biblioteki bota: nazwa, kiedy uzywac, kroki.',
        parameters: { name: 'string', when: 'string', steps: 'string' },
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 0,
      },
      execute: async (args: any) => {
        const nm = String((args && args.name) || '').trim();
        const wh = String((args && args.when) || '').trim();
        const st = String((args && args.steps) || '').trim();
        if (!nm || !st) { throw new Error('Podaj nazwe i kroki skilla.'); }
        this.saveSkillFile(nm, wh, st);
        return 'Zapisano skill: ' + nm;
      },
    });
    this.tools.register({
      definition: {
        name: 'skill_list',
        description: 'Lista procedur (skilli), ktore bot zna.',
        parameters: {},
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 6000,
      },
      execute: async () => this.listSkills(),
    });
    this.tools.register({
      definition: {
        name: 'skill_get',
        description: 'Odczytuje pelna procedure (skill) po nazwie.',
        parameters: { name: 'string' },
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 12000,
      },
      execute: async (args: any) => this.readSkill(String((args && args.name) || '').trim()),
    });
  }

  private toolSchemas(): any[] {
    return this.tools.getAllDefinitions().map((t: any) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.keys(t.parameters || {}).reduce((acc: any, key: string) => { acc[key] = { type: t.parameters[key] === 'number' ? 'number' : 'string' }; return acc; }, {}),
          required: Object.keys(t.parameters || {}),
        },
      },
    }));
  }

  private async executorTurn(messages: any[], tools: any[], toolChoice?: string): Promise<{ content: string, toolCalls: any[] }> {
    const provider: any = ((this as any).useCoder && this.coder) ? this.coder : this.executor;
    if (typeof provider.getCompletionWithTools === 'function') {
      try {
        return await provider.getCompletionWithTools(messages, tools, toolChoice);
      } catch (error: any) {
        console.log('[Swarm] Proba z tool_choice=' + String(toolChoice) + ' nieudana (' + error.message + ')');
        if (this.onEngineFailure && /429|rate limit|quota|limit token|tokenow|resource_exhausted|exhausted|overload|unavailable|503|401|invalid|authentication|unauthorized/i.test(String(error.message || ''))) { try { this.onEngineFailure(); } catch (e) { } }
        try {
          if (toolChoice && toolChoice !== 'auto') {
            const nudge = messages.concat([{ role: 'user', content: 'WYWOŁAJ NARZĘDZIE TERAZ. Nie odpowiadaj z pamięci - użyj odpowiedniego narzędzia i podaj wynik z jego działania.' }]);
            return await provider.getCompletionWithTools(nudge, tools, 'auto');
          }
          return await provider.getCompletionWithTools(messages, tools);
        } catch (error2: any) {
          console.log('[Swarm] Natywne narzedzia niedostepne (' + error2.message + '), bezpieczny tryb tekstowy.');
          try {
            const plain: string[] = [];
            for (const m of messages) {
              if (m.role === 'system') { continue; }
              if (m.role === 'tool') { plain.push('Wynik narzedzia: ' + String(m.content || '').slice(0, 4000)); continue; }
              if (m.tool_calls) { continue; }
              plain.push(String(m.content || ''));
            }
            const fallbackMessages: any[] = [
              { role: 'system', content: 'Jestes Omni, asystent. Odpowiedz po polsku, krotko i konkretnie, na podstawie podanych informacji. Nie wywoluj zadnych narzedzi.' },
              { role: 'user', content: plain.join(String.fromCharCode(10) + String.fromCharCode(10)).slice(0, 12000) },
            ];
            const content = await provider.getCompletion(fallbackMessages);
            return { content: content, toolCalls: [] };
          } catch (error3: any) {
            throw new Error('Model nie odpowiedzial: ' + error3.message);
          }
        }
      }
    }
    const content = await provider.getCompletion(messages);
    return { content: content, toolCalls: [] };
  }
  public onEvent: ((event: any) => void) | null = null;
  public onToken: ((chunk: string) => void) | null = null;

  private emit(event: any): void {
    if (!this.onEvent) { return; }
    try { this.onEvent(event); } catch (error) { }
  }

  public getApprovalManager(): any {
    return this.tools.approvalManager;
  }

  public listTools(): any[] {
    return this.tools.getAllDefinitions();
  }

  private stripMarkers(text: string): string {
    return text
      .split('[[DONE]]').join('')
      .split('[[APPROVED]]').join('')
      .split('[[REJECTED]]').join('')
      .split('[REJECTED BY REVIEWER]').join('')
      .trim();
  }

  private parseToolCalls(text: string): Array<{ name: string, args: any }> {
    const calls: Array<{ name: string, args: any }> = [];
    const marker = '[[CALL_TOOL:';
    let idx = text.indexOf(marker);
    while (idx !== -1) {
      const end = text.indexOf(']]', idx);
      if (end === -1) break;
      const inner = text.slice(idx + marker.length, end);
      const sep = inner.indexOf('|');
      const name = (sep === -1 ? inner : inner.slice(0, sep)).trim();
      let args: any = {};
      if (sep !== -1) {
        const raw = inner.slice(sep + 1).trim();
        try { args = JSON.parse(raw); } catch (error) { args = { input: raw }; }
      }
      if (name) calls.push({ name: name, args: args });
      idx = text.indexOf(marker, end);
    }
    return calls;
  }
  public registerTool(tool: any) {
    this.tools.register(tool);
  }

  public onWorker: ((event: any) => void) | null = null;

  /** Czy zadanie jest na tyle zlozone, by uruchomic roj rownoleglych botow. */
  private shouldUseSwarm(prompt: string, plan: string): boolean {
    if (String(process.env.OMNI_SWARM || '').trim() === 'off') { return false; }
    const lower = String(prompt || '').toLowerCase();
    const keys = ['zbuduj', 'aplikacj', 'projekt', 'refaktor', 'przygotuj', 'kilka plikow', 'wiele plikow', 'zaimplementuj', 'stworz aplikacje', 'napisz aplikacje'];
    let hit = false;
    for (const k of keys) { if (lower.indexOf(k) !== -1) { hit = true; break; } }
    if (!hit) { return false; }
    if (String(prompt || '').trim().length < 30) { return false; }
    return true;
  }

  /** Dzieli plan na N niezaleznych czesci. */
  private splitPlan(plan: string, max: number): string[] {
    const nl = String.fromCharCode(10);
    const lines: string[] = String(plan || '').split(nl).map((l) => l.trim()).filter((l) => l.length > 3);
    if (!lines.length) { return []; }
    if (lines.length === 1) { lines.push('Skoncz i sprawdz wynik'); }
    const parts = Math.min(Math.max(2, max), Math.max(2, Math.ceil(lines.length / 2)));
    const out: string[] = [];
    for (let i = 0; i < parts; i++) {
      const slice = lines.filter((l, idx) => idx % parts === i);
      if (slice.length) { out.push(slice.join(' | ')); }
    }
    return out;
  }

  /** Jeden robot roju: wykonuje tylko swoja czesc zadania. */
  private async runWorker(index: number, subtask: string, prompt: string, cwd: string): Promise<{ index: number, ok: boolean, text: string }> {
    const nl = String.fromCharCode(10);
    console.log('[Swarm] Bot ' + index + ' start');
    if (this.onWorker) { try { this.onWorker({ index: index, state: 'start', task: subtask.slice(0, 110) }); } catch (e) { } }
    const messages: any[] = [
      { role: 'system', content: (this.behaviorRules() + nl + this.capabilities(cwd) + String.fromCharCode(10) + this.readKnowledge()) + nl + 'Jestes jednym z rownoleglych botow Omni (roj). Wykonaj TYLKO swoja czesc zadania i zwroc konkretny wynik (kod, pliki, ustalenia). Nie opisuj pracy innych botow.' },
      { role: 'user', content: 'Zadanie glowne: ' + prompt + nl + 'Twoja czesc: ' + subtask },
    ];
    const schemas = this.toolSchemas();
    try {
      for (let i = 0; i < 3; i++) {
        const res = await this.executorTurn(messages, schemas, 'auto');
        const calls = res.toolCalls || [];
        if (!calls.length) {
          if (this.onWorker) { try { this.onWorker({ index: index, state: 'done', task: '' }); } catch (e) { } }
          return { index: index, ok: true, text: this.stripMarkers(res.content) };
        }
        messages.push({ role: 'assistant', content: res.content || null, tool_calls: calls });
        for (const call of calls) {
          const name = call.function && call.function.name;
          let args: any = {};
          try { args = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (e) { args = {}; }
          try {
            const output = await this.tools.executeTool(name, args, cwd);
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            messages.push({ role: 'tool', tool_call_id: call.id, content: this.compressToolOutput(text) });
          } catch (e: any) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + e.message });
          }
        }
      }
      const last = await this.executorTurn(messages, schemas, 'auto');
      if (this.onWorker) { try { this.onWorker({ index: index, state: 'done', task: '' }); } catch (e) { } }
      return { index: index, ok: true, text: this.stripMarkers(last.content) };
    } catch (error: any) {
      if (this.onWorker) { try { this.onWorker({ index: index, state: 'error', task: error.message }); } catch (e) { } }
      return { index: index, ok: false, text: 'Blad: ' + error.message };
    }
  }
  /** Czyta nauczone zasady i profil uzytkownika - to jest pamiec dlugoterminowa bota. */
  /** Biblioteka procedur bota (skille). */
  private skillPath(name: string): string {
    const slug = String(name || '').toLowerCase().replace(new RegExp('[^a-z0-9]+', 'g'), '-').replace(new RegExp('^-+|-+$', 'g'), '').slice(0, 60) || 'skill';
    return path.join(os.homedir(), '.omni', 'skills', slug + '.md');
  }

  private saveSkillFile(name: string, when: string, steps: string): void {
    const nl = String.fromCharCode(10);
    const dir = path.join(os.homedir(), '.omni', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    const body = '# ' + name + nl + 'KIEDY: ' + (when || 'gdy zadanie pasuje') + nl + nl + steps + nl;
    fs.writeFileSync(this.skillPath(name), body, 'utf8');
  }

  private listSkills(): string {
    const nl = String.fromCharCode(10);
    try {
      const dir = path.join(os.homedir(), '.omni', 'skills');
      if (!fs.existsSync(dir)) { return 'Brak zapisanych skilli.'; }
      const files = fs.readdirSync(dir).filter((f: string) => f.slice(-3) === '.md');
      if (!files.length) { return 'Brak zapisanych skilli.'; }
      return files.map((f: string) => {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8');
        const lines = raw.split(nl);
        const title = (lines[0] || f).replace(new RegExp('^#+ ', 'g'), '');
        const whenLine = lines.filter((l: string) => l.indexOf('KIEDY:') === 0)[0] || '';
        return '- ' + title + ' (' + whenLine.replace('KIEDY: ', '') + ')';
      }).join(nl);
    } catch (error) { return 'Blad odczytu skilli.'; }
  }

  private readSkill(name: string): string {
    try {
      const file = this.skillPath(name);
      if (!fs.existsSync(file)) { return 'Nie znam skilla o nazwie: ' + name; }
      return fs.readFileSync(file, 'utf8').slice(0, 6000);
    } catch (error) { return 'Blad odczytu skilla.'; }
  }
  /** Ostatnie wymiany z sesji (ciaglosc rozmowy: "to", "tamten plik"). */
  private recentHistory(sessionId: string, exchanges: number = 8, maxChars: number = 3000): string {
    try {
      const recs: any[] = this.memory.recent(sessionId, exchanges * 2) as any[];
      const lines: string[] = [];
      for (const rec of recs) {
        const role = String((rec && rec.role) || '');
        if (role !== 'user' && role !== 'assistant') { continue; }
        const text = String((rec && rec.content) || '').trim();
        if (!text) { continue; }
        lines.push((role === 'user' ? 'Uzytkownik: ' : 'Omni: ') + text.slice(0, 600));
      }
      let out = lines.join(String.fromCharCode(10));
      if (out.length > maxChars) { out = out.slice(out.length - maxChars); }
      return out;
    } catch (error) { return ''; }
  }

  /** Klasyfikuje bledy narzedzi (taksonomia) i zapisuje wzorce. */
  private classifyToolError(msg: string): string {
    const m = String(msg || '').toLowerCase();
    let kind = 'inne';
    if (m.indexOf('timeout') !== -1 || m.indexOf('przekrocz') !== -1 || m.indexOf('etimedout') !== -1) { kind = 'timeout'; }
    else if (m.indexOf('json') !== -1 || m.indexOf('argument') !== -1 || m.indexOf('schema') !== -1 || m.indexOf('required') !== -1) { kind = 'argumenty'; }
    else if (m.indexOf('permission') !== -1 || m.indexOf('eacces') !== -1 || m.indexOf('denied') !== -1) { kind = 'uprawnienia'; }
    else if (m.indexOf('fetch') !== -1 || m.indexOf('network') !== -1 || m.indexOf('econn') !== -1 || m.indexOf('http') !== -1) { kind = 'zewnetrzne'; }
    try {
      const f = path.join(os.homedir(), '.omni', 'failure-stats.json');
      let o: any = {};
      try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { o = {}; }
      o[kind] = (o[kind] || 0) + 1;
      fs.writeFileSync(f, JSON.stringify(o));
    } catch (e) { }
    return kind;
  }
  /** Pamiec hierarchiczna: streszczenie sesji + ekstrakcja trwalych faktow (z dlawikiem). */
  private async harvestMemory(sessionId: string, prompt: string, result: string): Promise<void> {
    try {
      const statePath = path.join(os.homedir(), '.omni', 'harvest-state.json');
      let st: any = {};
      try { st = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { st = {}; }
      if (Date.now() - Number(st[sessionId] || 0) < 10 * 60 * 1000) { return; }
      const recs: any[] = this.memory.recent(sessionId, 12) as any[];
      const lines: string[] = [];
      for (const r of recs) {
        const role = String((r && r.role) || '');
        if (role !== 'user' && role !== 'assistant') { continue; }
        lines.push((role === 'user' ? 'U: ' : 'A: ') + String((r && r.content) || '').slice(0, 300));
      }
      const conv = ((lines.length ? lines.join(String.fromCharCode(10)) : ('Zadanie: ' + prompt + String.fromCharCode(10) + 'Wynik: ' + String(result || ''))).slice(-2500));
      const messages = [
        { role: 'system' as const, content: 'Wyciagasz TRWALE fakty z rozmowy. Zwroc WYLACZNIE JSON: {"streszczenie":"1 zdanie","fakty":[{"typ":"preferencja|cel|ustalenie|blad","tresc":"..."}]}. Tylko fakty trwale i wazne dla przyszlych rozmow. Jesli brak - pusta lista.' },
        { role: 'user' as const, content: conv },
      ];
      const raw = await this.evolver.getCompletion(messages);
      const s = String(raw || '');
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      if (a === -1 || b <= a) { return; }
      st[sessionId] = Date.now();
      try { fs.writeFileSync(statePath, JSON.stringify(st)); } catch (e) { }
      const obj = JSON.parse(s.slice(a, b + 1));
      const sum = String((obj && obj.streszczenie) || '').trim();
      if (sum) { this.memory.appendTranscript(sessionId, 'summary', sum.slice(0, 300)); }
      const facts = Array.isArray(obj && obj.fakty) ? obj.fakty : [];
      let n = 0;
      for (const f of facts) {
        const typ = String((f && f.typ) || 'ustalenie').slice(0, 30);
        const tresc = String((f && f.tresc) || '').trim();
        if (!tresc) { continue; }
        this.memory.saveFact('hit_' + Date.now() + '_' + n, typ + ': ' + tresc.slice(0, 200));
        n++;
        if (n >= 6) { break; }
      }
      console.log('[Pamiec] Zapisano ' + n + ' faktow (sesja ' + sessionId + ')');
    } catch (error) { }
  }

  /** Deterministyczna odpowiedz o dzisiejsza date (bez zgadywania modelu). */
  private tryDirectDate(prompt: string): string | null {
    const low = this.foldPl(String(prompt || '').toLowerCase());
    const pats = ['jaka jest data', 'jaka data', 'jaka mamy date', 'dzisiejsza data', 'jaki jest dzien', 'jaki dzien', 'ktory mamy dzien', 'jaka jest dzisiaj data', 'data dzisiaj', 'dzisiaj data', 'jaka dzisiaj data'];
    let hit = false;
    for (const p of pats) { if (low.indexOf(p) !== -1) { hit = true; break; } }
    if (!hit) { return null; }
    const d = new Date();
    const dni = ['niedziela', 'poniedzialek', 'wtorek', 'sroda', 'czwartek', 'piatek', 'sobota'];
    const mies = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'wrzesnia', 'pazdziernika', 'listopada', 'grudnia'];
    const iso = d.toISOString().slice(0, 10);
    return 'Dzisiaj jest ' + dni[d.getDay()] + ', ' + String(d.getDate()) + ' ' + mies[d.getMonth()] + ' ' + String(d.getFullYear()) + ' (ISO: ' + iso + ').';
  }

  /** Rozpoznaje 'ustaw przypomnienie' w kodzie (bez decyzji modelu). */
  private tryDirectReminder(prompt: string): { text: string; at?: string; inMinutes?: number } | null {
    const raw = String(prompt || '');
    const low = this.foldPl(raw.toLowerCase());
    if (low.indexOf('przypomn') === -1) { return null; }
    let inMinutes: number | undefined;
    let at: string | undefined;
    let m = low.match(/za\s+(\d+)\s*minut/);
    if (m) { inMinutes = parseInt(m[1], 10); }
    if (inMinutes === undefined) { const g = low.match(/za\s+(\d+)\s*godzin/); if (g) { inMinutes = parseInt(g[1], 10) * 60; } }
    if (inMinutes === undefined && low.indexOf('za godzine') !== -1) { inMinutes = 60; }
    if (inMinutes === undefined && at === undefined) { const hm = low.match(/o\s+(\d{1,2})[:.](\d{2})/); if (hm) { const d = new Date(); d.setHours(parseInt(hm[1], 10), parseInt(hm[2], 10), 0, 0); if (d.getTime() < Date.now()) { d.setDate(d.getDate() + 1); } at = d.toISOString(); } }
    if (inMinutes === undefined && at === undefined && low.indexOf('jutro') !== -1) { const jm = low.match(/jutro(?:\s+o\s+)?(\d{1,2})(?:[:.](\d{2}))?/); const d = new Date(); d.setDate(d.getDate() + 1); if (jm) { d.setHours(parseInt(jm[1], 10), jm[2] ? parseInt(jm[2], 10) : 0, 0, 0); } else { d.setHours(9, 0, 0, 0); } at = d.toISOString(); }
    if (inMinutes === undefined && at === undefined) { return null; }
    let text = raw;
    text = text.replace(/przypomnij(?:\s+mi)?/i, '').replace(/ustaw\s+przypomnienie/i, '').replace(/za\s+\d+\s*minut\w*/i, '').replace(/za\s+\d+\s*godzin\w*/i, '').replace(/za\s+godzin\w*/i, '').replace(/jutro/i, '').replace(/o\s+\d{1,2}[:.]\d{2}/i, '').trim();
    if (!text || text.length < 2) { text = raw; }
    const res: any = { text };
    if (inMinutes !== undefined) { res.inMinutes = inMinutes; }
    if (at !== undefined) { res.at = at; }
    return res;
  }

  /** Kompresja dlugich wynikow narzedzi (chroni kontekst bez kosztu tokenow). */
  private compressToolOutput(text: string, limit: number = 2500): string {
    const s = String(text || '');
    if (s.length <= limit) { return s; }
    const headLen = Math.floor(limit * 0.6);
    const tailLen = Math.floor(limit * 0.35);
    const head = s.slice(0, headLen);
    const tail = s.slice(s.length - tailLen);
    return head + String.fromCharCode(10) + '[...pominieto ' + String(s.length - headLen - tailLen) + ' znakow...]' + String.fromCharCode(10) + tail;
  }

  /** Najtrafniejsze wspomnienia (FTS5 BM25) pod konkretne pytanie. */
  private relevantMemory(query: string, limit: number = 3): string {
    try {
      const hits: any[] = this.memory.search(query, limit) as any[];
      if (!hits || !hits.length) { return ''; }
      const lines: string[] = [];
      for (const hit of hits) {
        const text = String((hit && hit.content) || '').trim();
        if (!text) { continue; }
        lines.push('- ' + text.slice(0, 300));
      }
      return lines.join(String.fromCharCode(10));
    } catch (error) { return ''; }
  }

  private readKnowledge(): string {
    const nl = String.fromCharCode(10);
    try {
      const dir = path.join(os.homedir(), '.omni', 'memory');
      const parts: string[] = [];
      const skillsPath = path.join(dir, 'skills.md');
      if (fs.existsSync(skillsPath)) {
        const skills = fs.readFileSync(skillsPath, 'utf8').slice(-3000);
        if (skills.trim().length > 10) { parts.push('NAUCZONE ZASADY (z wlasnych doswiadczen - stosuj je):' + nl + skills); }
      }
      const profPath = path.join(dir, 'user-profile.md');
      if (fs.existsSync(profPath)) {
        const prof = fs.readFileSync(profPath, 'utf8').slice(-1500);
        if (prof.trim().length > 10) { parts.push('O UZYTKOWNIKU (pamietaj):' + nl + prof); }
      }
      const sdir = path.join(os.homedir(), '.omni', 'skills');
      if (fs.existsSync(sdir)) {
        const idx = this.listSkills();
        if (idx && idx.indexOf('Brak zapisanych') === -1) { parts.push('TWOJE SKILLE (procedury - uzyj skill_get, gdy zadanie pasuje):' + nl + idx); }
      }
      return parts.join(nl);
    } catch (error) { return ''; }
  }

  /** Zapisuje nowa zasade do pamieci dlugoterminowej (bez duplikatow). */
  private saveSkill(rule: string): void {
    const nl = String.fromCharCode(10);
    try {
      const clean = String(rule || '').trim();
      if (clean.length < 20) { return; }
      const dir = path.join(os.homedir(), '.omni', 'memory');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'skills.md');
      const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ('# Nauczone zasady Omni' + nl);
      const first = clean.split(nl).filter((l) => l.trim().length > 3).slice(0, 3).join(' ');
      const key = first.slice(0, 60).toLowerCase();
      if (prev.toLowerCase().indexOf(key) !== -1) { return; }
      fs.writeFileSync(file, prev + '- [' + new Date().toISOString().slice(0, 10) + '] ' + first.replace(new RegExp('#+ ', 'g'), '') + nl, 'utf8');
    } catch (error) { }
  }
  async executeTask(sessionId: string, prompt: string, cwd: string): Promise<Task> {
    this.busy = true;
    try { return await this.executeTaskInner(sessionId, prompt, cwd); }
    finally { this.busy = false; }
  }

  private async executeTaskInner(sessionId: string, prompt: string, cwd: string): Promise<Task> {
    const taskId = uuidv4();
    const trimmedLower = String(prompt).trim().toLowerCase();
    const exact = trimmedLower === '/dokladnie' || trimmedLower.indexOf('/dokladnie ') === 0;
    if (exact) { prompt = String(prompt).trim().slice('/dokladnie'.length).trim(); }
    const foldedTask = this.foldPl(String(prompt).toLowerCase());
    const codingKeys = ['napisz', 'kod', 'program', 'funkcj', 'klasa', 'implement', 'refaktor', 'debug', 'bug', 'endpoint', 'api', 'test', 'skrypt', 'aplikacj', 'modul', 'komponent', 'typescript', 'javascript', 'python'];
    let useCoder = false;
    for (const ck of codingKeys) { if (foldedTask.indexOf(ck) !== -1) { useCoder = true; break; } }
    (this as any).useCoder = useCoder;
    const task: Task = {
      id: taskId,
      sessionId,
      prompt,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      iterations: 0,
      maxIterations: exact ? 20 : Number(process.env.OMNI_MAX_ITERATIONS ?? 12),
      currentAgent: 'planner',
    };

    const hist = this.recentHistory(sessionId, 8, 3000);
    const rel = this.relevantMemory(String(prompt), 3);
    this.memory.appendTranscript(sessionId, 'system', `Task started: ${prompt}`);
    this.memory.appendTranscript(sessionId, 'user', String(prompt).slice(0, 1200));

    // Deterministyczna data i przypomnienia: nie czekamy na decyzje modelu.
    const directDate = this.tryDirectDate(prompt);
    if (directDate) {
      task.status = 'completed';
      task.result = directDate;
      this.memory.appendTranscript(sessionId, 'assistant', directDate);
      task.updatedAt = Date.now();
      return task;
    }
    const directRem = this.tryDirectReminder(prompt);
    if (directRem) {
      try {
        const out = await this.tools.executeTool('reminder_set', directRem, cwd);
        task.status = 'completed';
        task.result = String(typeof out === 'string' ? out : JSON.stringify(out));
        this.memory.appendTranscript(sessionId, 'assistant', task.result);
      } catch (error: any) {
        task.status = 'failed';
        task.error = 'Nie udalo sie ustawic przypomnienia: ' + error.message;
      }
      task.updatedAt = Date.now();
      return task;
    }

    try {
      // KROK 1: Planner dekomponuje zadanie
      this.emit({ kind: 'thinking', text: 'Analizuje zadanie...' });
      const plan = await this.runPlanner(prompt, exact);
      this.memory.appendTranscript(sessionId, 'planner', `Plan: ${plan}`);

      // KROK 2: Executor wykonuje kroki
      let executionResult = '';
      let draftAnswer = '';
      let usedTools = false;
      let forceContinue = 0;
      let noProgress = 0;
      const execNames: string[] = [];
      const toolSchemas = this.toolSchemas();
      const lowerPrompt = String(prompt).toLowerCase();
      const searchKeys = ['cen', 'kurs', 'koszt', 'ile kosztuje', 'bitcoin', 'btc', 'ethereum', 'krypto', 'walut', 'wymian', 'wiadomosc', 'wydarzen', 'aktualn', 'dzisiaj', 'dzisiejsz', 'pogod', 'prognoz', 'wynik', 'notowan'];
      let needsSearch = false;
      for (const key of searchKeys) { if (lowerPrompt.indexOf(key) !== -1) { needsSearch = true; break; } }
      const actionKeys = ['zbuduj', 'stworz', 'napisz plik', 'aplikacj', 'projekt', 'refaktor', 'zaimplementuj', 'przygotuj', 'zapisz plik', 'edytuj plik', 'wypchnij', 'commit'];
      let isAction = false;
      for (const key of actionKeys) { if (lowerPrompt.indexOf(key) !== -1) { isAction = true; break; } }
      const folded = this.foldPl(lowerPrompt);
      const needToolStems = ['utworz', 'napisz', 'skrypt', 'kod', 'program', 'uruchom', 'commit', 'zainstaluj', 'ile plik', 'plik', 'folder', 'katalog', 'policz', 'sprawdz', 'wypisz', 'pokaz', 'lista', 'znajdz', 'cena', 'kurs', 'walut', 'pogod', 'aktualn', 'pobierz', 'przeczytaj', 'otworz', 'rozmiar', 'dysk', 'wersj', 'stan ', 'zawartosc'];
      for (const st of needToolStems) { if (folded.indexOf(st) !== -1) { isAction = true; break; } }
      const messages: any[] = [
        { role: 'system', content: (this.behaviorRules() + String.fromCharCode(10) + this.capabilities(cwd) + String.fromCharCode(10) + this.readKnowledge()) + String.fromCharCode(10) + 'WAZNE: gdy pytanie dotyczy faktow, kursow, wiadomosci, pogody, przepisow lub czegokolwiek z internetu - NAJPIERW wywolaj odpowiednie narzedzie. Nie odpowiadaj na takie pytania z pamieci.' },
        { role: 'user', content: 'Zadanie: ' + prompt + (rel ? '\n\nTRAFNA WIEDZA Z PAMIECI:\n' + rel : '') + (hist ? '\n\nPOPRZEDNIE WYMIANY (kontekst rozmowy):\n' + hist : '') + (exact ? '\n\nTRYB DOKLADNIE: sprawdzaj kazde twierdzenie narzedziem, nie zgaduj, podaj zrodlo.' : '') + '\nPlan:\n' + plan },
      ];

      for (let i = 0; i < task.maxIterations; i++) {
        const iterStartCount = execNames.length;
        if (i === 0 && this.shouldUseSwarm(prompt, plan)) {
          const parts = this.splitPlan(plan, Number(String(process.env.OMNI_SWARM_WORKERS || '3')));
          if (parts.length >= 2) {
            this.emit({ kind: 'writing', text: 'Roj botow: ' + parts.length + ' pracuje rownolegle...' });
            console.log('[Swarm] ROJ: ' + parts.length + ' botow rownolegle');
            const results = await Promise.all(parts.map((part: string, idx: number) => this.runWorker(idx + 1, part, prompt, cwd)));
            const merged = results.map((r: any) => '### Bot ' + r.index + String.fromCharCode(10) + r.text).join(String.fromCharCode(10) + String.fromCharCode(10));
            executionResult += merged;
            usedTools = true;
            this.memory.appendTranscript(sessionId, 'swarm', 'Roj: ' + parts.length + ' botow rownolegle');
            break;
          }
        }

        task.iterations = i + 1;        if (i === 0 && !exact && !needsSearch && !isAction) {
          this.emit({ kind: 'writing', text: 'Pisze odpowiedz...' });
          const plainFast: any[] = [
            { role: 'system', content: 'Jestes Omni, polski asystent. DZISIAJ JEST: ' + new Date().toISOString().slice(0, 10) + ' (nigdy nie podawaj innej daty). Odpowiedz krotko i konkretnie po polsku. Nie wywoluj zadnych narzedzi.' + (hist ? '\n\nPOPRZEDNIE WYMIANY (kontekst rozmowy):\n' + hist : '') },
            { role: 'user', content: String(prompt) },
          ];
          let streamedFast = '';
          try {
            const prov: any = this.executor;
            if (this.onToken && typeof prov.streamCompletion === 'function') {
              console.log('[Swarm] Strumieniowanie odpowiedzi...');
              for await (const chunk of prov.streamCompletion(plainFast)) {
                streamedFast += chunk;
                this.onToken(chunk);
              }
            } else {
              streamedFast = await prov.getCompletion(plainFast);
            }
          } catch (error: any) {
            console.log('[Swarm] Strumien nieudany (' + error.message + ')');
            try { streamedFast = await (this.executor as any).getCompletion(plainFast); } catch (error2: any) { streamedFast = ''; }
          }
          const cleanedFast = this.stripMarkers(streamedFast);
          if (cleanedFast) { draftAnswer = cleanedFast; }
          break;
        }

        const response = await this.executorTurn(messages, toolSchemas, (i === 0 && needsSearch) ? 'required' : 'auto');
        const toolCalls = response.toolCalls || [];
        console.log('[Swarm] Iteracja ' + (i + 1) + ': narzedzia=' + (toolCalls.length ? toolCalls.map((c: any) => c.function.name).join(',') : 'brak'));

        if (!toolCalls.length) {
          const textCalls = this.parseToolCalls(response.content);
          if (textCalls.length) {
            for (const call of textCalls) {
              usedTools = true;
              try {
                const output = await this.tools.executeTool(call.name, call.args, cwd);
                const text = typeof output === 'string' ? output : JSON.stringify(output);
                executionResult += text;
                this.memory.appendTranscript(sessionId, 'tool', call.name + ': ' + text.slice(0, 400));
              } catch (error: any) {
                executionResult += 'BLAD ' + call.name + ': ' + error.message;
              }
            }
            messages.push({ role: 'user', content: 'Wyniki narzedzi:\n' + executionResult });
            continue;
          }
          const cleaned = this.stripMarkers(response.content);
          const actionVerbs = ['napisz','utworz','stworz','zbuduj','zrob ','przygotuj','zaimplementuj','zainstaluj','uruchom','zapisz','skonfiguruj','dodaj','zrefaktoruj'];
          const actionNouns = ['skrypt','plik','kod','program','aplikacj','serwer','stron','folder','modul'];
          const needDoing = actionVerbs.some((k) => folded.indexOf(k) !== -1) && actionNouns.some((k) => folded.indexOf(k) !== -1);
          if (needDoing && forceContinue < 3 && (!usedTools || (execNames.indexOf('file_write') === -1 && execNames.indexOf('shell_exec') === -1))) {
            forceContinue++;
            console.log('[Swarm] STRAZ WYKONANIA: wymuszam kontynuacje (' + forceContinue + '/3)');
            this.emit({ kind: 'thinking', text: 'Kontynuuje wykonywanie zadania...' });
            messages.push({ role: 'assistant', content: response.content || '' });
            messages.push({ role: 'user', content: 'NIE SKONCZYLES ZADANIA. Twoj plan: ' + plan + ' Wykonaj TERAZ kolejny krok planu, uzywajac narzedzi (np. file_write, shell_exec). Nie pisz odpowiedzi koncowej, dopoki nie wykonasz ostatniego kroku planu i nie sprawdzisz wyniku.' });
            continue;
          }
          if (cleaned) { draftAnswer = cleaned; }
          break;
        }

        messages.push({ role: 'assistant', content: response.content || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          usedTools = true;
          const name = call.function && call.function.name;
          let args: any = {};
          try { args = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (error) { args = {}; }
          try {
            console.log('[Swarm] Wykonuje narzedzie: ' + name);
            this.emit({ kind: 'tool', text: name });
            const output = await this.tools.executeTool(name, args, cwd);
            execNames.push(String(name));
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            executionResult += text;
            messages.push({ role: 'tool', tool_call_id: call.id, content: this.compressToolOutput(text) });
            this.memory.appendTranscript(sessionId, 'tool', name + ': ' + text.slice(0, 400));
          } catch (error: any) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD (' + this.classifyToolError(error.message) + '): ' + error.message });
          }
        }
        if (execNames.length === iterStartCount) { noProgress++; } else { noProgress = 0; }
        if (noProgress >= 2) { console.log('[Swarm] EARLY STOP: brak postepu przez 2 iteracje.'); break; }
      }

      if (usedTools || !draftAnswer) {
        this.emit({ kind: 'writing', text: 'Pisze odpowiedz...' });
        const plain: any[] = [
          { role: 'system', content: (this.capabilities(cwd) + String.fromCharCode(10) + this.readKnowledge()) },
          { role: 'user', content: 'Zadanie: ' + prompt + (hist ? '\n\nPOPRZEDNIE WYMIANY (kontekst rozmowy):\n' + hist : '') },
        ];
        for (const m of messages) {
          if (m.role === 'tool') { plain.push({ role: 'user', content: 'Wynik narzedzia: ' + this.compressToolOutput(String(m.content || '')) }); }
        }
        plain.push({ role: 'user', content: 'Napisz teraz konkretna odpowiedz dla uzytkownika po polsku. Nie wywoluj narzedzi.' });
        let streamed = '';
        try {
          const provider: any = ((this as any).useCoder && this.coder) ? this.coder : this.executor;
          if (this.onToken && typeof provider.streamCompletion === 'function') {
            console.log('[Swarm] Strumieniowanie odpowiedzi...');
            for await (const chunk of provider.streamCompletion(plain)) {
              streamed += chunk;
              this.onToken(chunk);
            }
          } else {
            streamed = await provider.getCompletion(plain);
          }
        } catch (error: any) {
          console.log('[Swarm] Strumien nieudany (' + error.message + '), zwykla odpowiedz.');
          try { streamed = await (this.executor as any).getCompletion(plain); } catch (error2: any) { streamed = ''; }
        }
        const cleaned = this.stripMarkers(streamed);
        if (cleaned) { draftAnswer = cleaned; }
      }


      const norm = (s: string) => String(s).toLowerCase().split(String.fromCharCode(261)).join("a").split(String.fromCharCode(263)).join("c").split(String.fromCharCode(281)).join("e").split(String.fromCharCode(322)).join("l").split(String.fromCharCode(324)).join("n").split(String.fromCharCode(243)).join("o").split(String.fromCharCode(347)).join("s").split(String.fromCharCode(378)).join("z").split(String.fromCharCode(380)).join("z");
      const denialWords = ['nie mam dostepu', 'nie posiadam', 'nie mam wiedzy', 'nie moge podac aktualnej', 'nie moge sprawdzic', 'nie moge udzielic', 'nie jestem w stanie sprawdzic', 'nie mam informacji', 'moja wiedza konczy', 'sprawdz na stron', 'sprawdz sam', 'otworz jedna z', 'poszukaj na', 'skorzystaj z serwis'];
      const lowerAnswer = norm(draftAnswer);
      let denied = false;
      for (const dw of denialWords) { if (lowerAnswer.indexOf(dw) !== -1) { denied = true; break; } }
      if (denied) {
        console.log('[Swarm] Wykryto odmowe - wymuszam sprawdzenie w zrodlach');
        this.emit({ kind: 'writing', text: 'Sprawdzam w zrodlach...' });
        try {
          const nl2 = String.fromCharCode(10);
          const forced: any[] = [
            { role: 'system', content: this.capabilities(cwd) + nl2 + this.readKnowledge() + nl2 + 'NIE WOLNO Ci odmawiac ani odsylac uzytkownika do stron. Uzyj narzedzi (crypto_price, news, web_search) i podaj konkretna odpowiedz z danymi.' },
            { role: 'user', content: String(prompt) },
          ];
          const res1 = await this.executorTurn(forced, toolSchemas, 'required');
          const calls1 = res1.toolCalls || [];
          if (calls1.length) {
            forced.push({ role: 'assistant', content: res1.content || null, tool_calls: calls1 });
            for (const call of calls1) {
              const nm = call.function && call.function.name;
              let ar: any = {};
              try { ar = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (e) { ar = {}; }
              try {
                const outp = await this.tools.executeTool(nm, ar, cwd);
                forced.push({ role: 'tool', tool_call_id: call.id, content: String(typeof outp === 'string' ? outp : JSON.stringify(outp)).slice(0, 6000) });
              } catch (e: any) {
                forced.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + e.message });
              }
            }
            const res2 = await this.executorTurn(forced, toolSchemas, 'auto');
            const fixed = this.stripMarkers(res2.content);
            if (fixed && fixed.trim().length > 5) { draftAnswer = fixed; }
          }
        } catch (error: any) {
          console.log('[Swarm] Wymuszone sprawdzenie nieudane: ' + error.message);
        }
      }
      // STRAZ WERYFIKACJI: twierdzenie bez sprawdzenia = wymus narzedzia (tak pracuje asystent).
      try {
        const claimWords = ['gotowe', 'uruchomion', 'uruchomilem', 'dziala', 'zrobilem', 'utworzylem', 'zapisalem', 'commituje', 'zainstalowalem', 'wypchna'];
        const lowerClaim = norm(draftAnswer);
        let claimed = false;
        for (const cw of claimWords) { if (lowerClaim.indexOf(cw) !== -1) { claimed = true; break; } }
        const runningWords = ['dziala w tle', 'dziala niezaleznie', 'nasluchuje', 'dziala na porcie', 'dostepny pod', 'przetrwa', 'serwer dziala', 'uruchomiony w tle'];
        let runningClaim = false;
        for (const rw of runningWords) { if (lowerClaim.indexOf(rw) !== -1) { runningClaim = true; break; } }
        if ((claimed && !usedTools) || runningClaim) {
          console.log('[Swarm] Twierdzenie bez sprawdzenia - wymuszam weryfikacje narzedziami.');
          this.emit({ kind: 'writing', text: 'Sprawdzam to narzedziami...' });
          const nl3 = String.fromCharCode(10);
          const forcedV: any[] = [
            { role: 'system', content: this.capabilities(cwd) + nl3 + this.readKnowledge() + nl3 + 'Zanim odpowiesz: SPRAWDZ KOMENDA, czy to naprawde dziala (np. curl -sS -m 5 http://127.0.0.1:PORT/ albo ps aux | grep). Nie twierdz bez dowodu. Jesli sprawdzenie sie nie powiedzie - napisz WPROST, ze nie dziala, i co poszlo nie tak.' },
            { role: 'user', content: String(prompt) },
          ];
          const vr1 = await this.executorTurn(forcedV, toolSchemas, 'auto');
          const vcalls = vr1.toolCalls || [];
          if (vcalls.length) {
            forcedV.push({ role: 'assistant', content: vr1.content || null, tool_calls: vcalls });
            for (const call of vcalls) {
              const nm = call.function && call.function.name;
              let ar: any = {};
              try { ar = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (e) { ar = {}; }
              try {
                const outp = await this.tools.executeTool(nm, ar, cwd);
                forcedV.push({ role: 'tool', tool_call_id: call.id, content: String(typeof outp === 'string' ? outp : JSON.stringify(outp)).slice(0, 6000) });
              } catch (e: any) {
                forcedV.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + e.message });
              }
            }
            const vr2 = await this.executorTurn(forcedV, toolSchemas, 'auto');
            const vfixed = this.stripMarkers(vr2.content);
            if (vfixed && vfixed.trim().length > 5) { draftAnswer = vfixed; }
          }
        }
      } catch (error: any) {
        console.log('[Swarm] Straz weryfikacji nieudana: ' + error.message);
      }
      // TOP4: obowiazkowy self-critique (Krytyk) przed oddaniem odpowiedzi.
      if (draftAnswer && String(draftAnswer).trim().length > 20) {
        try {
          const crit = await this.executor.getCompletion([
            { role: 'system', content: ((this as any).useCoder ? 'Jestes takze Testerem: sprawdz kod pod katem bledow i uruchom test; jesli kod nie byl uruchomiony, zaznacz to wprost. ' : '') + 'Jestes SUROWYM Krytykiem faktow. Usun lub popraw KAZDE twierdzenie bez pokrycia w wynikach narzedzi. Nie dodawaj nic od siebie i nie chwal. Zwroc WYLACZNIE poprawiona odpowiedz po polsku.' },
            { role: 'user', content: 'Zadanie: ' + prompt + String.fromCharCode(10) + String.fromCharCode(10) + 'Odpowiedz: ' + String(draftAnswer).slice(0, 3000) },
          ]);
          const fixed = this.stripMarkers(crit);
          if (fixed && fixed.trim().length > 5) { draftAnswer = fixed; }
        } catch (error) { }
      }

      if (!draftAnswer || !String(draftAnswer).trim()) {
        draftAnswer = 'Nie udalo sie uzyskac odpowiedzi od silnika (' + String(process.env.OMNI_LLM_PROVIDER || 'aktywny') + '). Najczestsza przyczyna: klucz API odrzucony albo limit darmowego planu. Sprawdz zakladke Klucze API (jest przycisk Sprawdz klucze) i sprobuj ponownie.';
      }
      // KROK 4: Evolver uczy sie z zadania (opcjonalny - blad nie moze zepsuc odpowiedzi)
      try { await this.runEvolver(prompt, executionResult); } catch (error) { }

      task.status = 'completed';
      this.memory.appendTranscript(sessionId, 'assistant', String(draftAnswer || '').slice(0, 2000));
      // Odpowiedź wykonawcy jest ważniejsza niż marudzenie reviewera.
      task.result = draftAnswer || executionResult;
      try { await this.harvestMemory(sessionId, prompt, String(draftAnswer || executionResult || '')); } catch (error) { }
      this.memory.appendTranscript(sessionId, 'system', `Task completed: ${taskId}`);
    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      this.memory.appendTranscript(sessionId, 'system', `Task failed: ${error.message}`);
    }

    task.updatedAt = Date.now();
    this.emit({ kind: 'done', text: '' });
    return task;
  }

  /** Realne mozliwosci bota - wstrzykiwane do promptow, zeby nie zmyslal ograniczen. */
  private capabilities(cwd: string): string {
    const NL = String.fromCharCode(10);
    const tools = this.tools.getAllDefinitions().map((t: any) => '- ' + t.name + ': ' + t.description).join(NL);
    const now = new Date().toISOString().slice(0, 10);
    return [
      'Jestes Omni - osobisty asystent AI dzialajacy na komputerze uzytkownika. Dzisiejsza data: ' + now + '.',
      'Katalog roboczy: ' + cwd + '.',
      'MASZ NARZEDZIA - uzywaj ich zamiast mowic, ze czegos nie potrafisz:',
      tools,
      'MASZ DOSTEP DO INTERNETU (web_search, web_fetch). Mozesz sprawdzac biezace informacje, wiadomosci i strony. NIE twierdz, ze nie wiesz co sie dzialo po 2024 roku - po prostu wyszukaj.',
      'MASZ PAMIEC TRWALA (memory_save, memory_search) - zapisuj wazne ustalenia i preferencje uzytkownika.',
      'MASZ ROZMOWE GLOSOWA: uzytkownik moze mowic zamiast pisac (przycisk z ikona mikrofonu w czacie).',
      'GDY KTOS MOWI, ZE NIE SŁYSZY TWOJEGO GLOSU - odpowiedz dokladnie tak: 1) kliknij przycisk "Czytaj" pod moja odpowiedzia, 2) albo wlacz w Ustawieniach panelu opcje "Czytaj odpowiedzi na glos", 3) dla rozmowy glosem wlacz "Tryb rozmowy (hands-free)" w Ustawieniach. NIE odsylaj do narratora systemowego ani zewnetrznych czytnikow - mam wlasny glos.',
      'MASZ DOSTEP DO PLIKOW i POWLOKI na tym komputerze.',
      'MASZ GLOS: Twoje odpowiedzi mozna odczytac na glos (przycisk Czytaj), uzytkownik moze tez mowic do Ciebie przez mikrofon, a wlasne glosy da sie wgrywac. NIGDY nie pisz, ze nie mozesz mowic ani generowac dzwieku.',
      'MASZ GENEROWANIE OBRAZKOW: narzedzie image_generate tworzy grafike. Gdy ktos poprosi o obrazek, uzyj tego narzedzia i podaj w odpowiedzi adres /image/... - panel wyswietli obrazek.',
      'MASZ AUTOMATYZACJE: mozesz wykonywac zadania o wyznaczonych porach (zakladka Automatyzacje).',
      'MASZ PRZYPOMNIENIA: narzedzie reminder_set ustawia przypomnienie (text + at ISO albo inMinutes). Gdy ktos prosi o przypomnienie - OD RAZU uzyj reminder_set. NIE odmawiaj i nie odsylaj do telefonu. Lista: reminder_list.',
      'UMIESZ BUDOWAC APLIKACJE I PRACOWAC Z GITEM: pisz kod (file_write), uruchamiaj buildy, testy i komendy (shell_exec), sprawdzaj stan repozytorium (git_status, git_diff), zatwierdzaj zmiany (git_add_commit), wypychaj na GitHub (git_push), tworz nowe repozytoria (github_create_repo) i korzystaj z API GitHuba (github_api). Pracuj krok po kroku, po kazdej zmianie sprawdzaj wynik (build/test) i dopiero potem wypychaj.',
      'ZASADY: nie zmyslaj danych - uzyj narzedzia. Na kursy krypto uzyj crypto_price, na biezace wydarzenia i wiadomosci uzyj news, na reszte web_search. Odpowiadaj po polsku, krotko i konkretnie.',
    ].join(NL);
  }
  /** Zamienia JSON planera na czytelna liste krokow (z zaleznosciami). */
  private formatPlan(raw: string): string {
    try {
      const s = String(raw || '');
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      if (a === -1 || b <= a) { return s; }
      const obj = JSON.parse(s.slice(a, b + 1));
      const steps = Array.isArray(obj && obj.steps) ? obj.steps : [];
      if (!steps.length) { return s; }
      const lines: string[] = [];
      for (const st of steps) {
        const id = (st && st.id != null) ? String(st.id) : String(lines.length + 1);
        const opis = String((st && (st.opis || st.op || st.step)) || '').trim();
        if (!opis) { continue; }
        const chk = String((st && (st.sprawdzenie || st.check)) || '').trim();
        const dep = Array.isArray(st && st.zalezy_od) ? st.zalezy_od.join(',') : '';
        lines.push(id + '. ' + opis + (chk ? ' [sprawdzenie: ' + chk + ']' : '') + (dep ? ' (zalezy od: ' + dep + ')' : ''));
      }
      return lines.length ? lines.join(String.fromCharCode(10)) : s;
    } catch (error) { return String(raw || ''); }
  }

  private async runPlanner(prompt: string, exact: boolean = false): Promise<string> {
    const cwd = this.workspaceCwd;
    const messages = [
      { role: 'system' as const, content: ((this as any).useCoder ? 'Jestes takze Architektem: przed krokami ustal strukture plikow i modulow oraz interfejsy. ' : '') + 'Jestes WYLACZNIE Plannerem: nie wykonujesz krokow i nie odpowiadasz uzytkownikowi, tylko planujesz. Zwroc plan WYLACZNIE jako JSON (bez komentarzy): {"steps":[{"id":1,"opis":"...","sprawdzenie":"...","zalezy_od":[]}]}. Zasady: kazdy krok to jedna czynnosc wykonywalna narzedziem (file_write, file_read, shell_exec, web_search, web_fetch); pole sprawdzenie mowi jak potwierdzisz sukces; ostatni krok to weryfikacja calosci; od 3 do ' + (exact ? 10 : 8) + ' krokow; zalezy_od to lista id krokow wykonanych wczesniej. Nie wywoluj narzedzi. Jesli zadanie jest koderskie (pisanie/refaktor kodu), uwzglednij krok testu (napisz test albo uruchom istniejace testy) oraz krok weryfikacji (typecheck/lint). Katalog roboczy: ' + cwd + '.' },
      { role: 'user' as const, content: prompt }
    ];
    try {
      const raw = await this.planner.getCompletion(messages);
      return this.formatPlan(raw);
    } catch (error) {
      return prompt;
    }
  }
  private async runExecutor(plan: string, previousContext: string, cwd: string, finalOnly: boolean = false): Promise<string> {
    const tools = this.tools.getAllDefinitions().map((t: any) => '- ' + t.name + ': ' + t.description).join('\n');
    const system = finalOnly
      ? 'Jestes Executorem. Nie wolno Ci wywolywac narzedzi. Na podstawie wynikow narzedzi napisz konkretna odpowiedz po polsku dla uzytkownika.'
      : 'Jestes Executorem i masz realne narzedzia. Katalog roboczy: ' + cwd + '. ZASADY: jesli potrzebujesz danych z komputera, odpowiedz WYLACZNIE jednym wierszem w formacie [[CALL_TOOL:nazwa|{"argument":"wartosc"}]] i niczym wiecej. Przyklady: [[CALL_TOOL:file_list|{"path":"packages"}]] , [[CALL_TOOL:shell_exec|{"command":"ls packages"}]] , [[CALL_TOOL:file_read|{"path":"package.json"}]]. Dostepne narzedzia:\n' + tools + '\nAby wywolac narzedzie, napisz DOKLADNIE w osobnej linii: [[CALL_TOOL:nazwa|{\"argument\":\"wartosc\"}]] i nic wiecej. Jesli masz juz wynik, napisz gotowa odpowiedz po polsku, bez wywolywania narzedzi.';
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: 'Plan:\n' + plan + '\n\nWyniki dotychczas:\n' + previousContext }
    ];
    return await this.executor.getCompletion(messages);
  }
  private async runReviewer(originalPrompt: string, plan: string, action: string, cwd: string): Promise<string> {
    const messages = [
      { role: 'system' as const, content: 'Jestes SUROWYM Reviewerem. Szukaj luk, bledow i twierdzen bez pokrycia. Nie chwal. Jesli odpowiedz zawiera fakt bez potwierdzenia albo nie odpowiada na zadanie, odpowiedz [[REJECTED]] i podaj JEDEN konkretny powod. Jesli naprawde nie ma zastrzezen, odpowiedz dokladnie [[APPROVED]].' },
      { role: 'user' as const, content: `Zadanie użytkownika:\n${originalPrompt}\n\nPlan:\n${plan}\n\nDo oceny:\n${action}\n\nKatalog roboczy: ${cwd}` }
    ];
    return await this.reviewer.getCompletion(messages);
  }

  private async runEvolver(originalPrompt: string, result: string): Promise<void> {
    // Evolver z weryfikacja: nowa zasada zapisywana DOPIERO po sprawdzeniu.
    const messages = [
      { role: 'system' as const, content: 'Jesteś Evolverem. Na podstawie wykonanego zadania, stwórz krótką notatkę w formacie Markdown, która może być przydatna w przyszłości jako "skill".' },
      { role: 'user' as const, content: `Zadanie: ${originalPrompt}\nWynik: ${result}` }
    ];
    const skill = await this.evolver.getCompletion(messages);
    if (!skill || String(skill).trim().length < 20) { return; }
    let verified = false;
    try {
      const check = [
        { role: 'system' as const, content: 'Jestes Weryfikatorem wiedzy. Ocena: czy NOWA ZASADA jest poprawna, konkretna i NIE powtarza ani nie przeczy istniejacej wiedzy. Zwroc WYLACZNIE JSON: {"ok":true,"powod":"..."}.' },
        { role: 'user' as const, content: 'ISTNIEJACA WIEDZA:' + String.fromCharCode(10) + String(this.readKnowledge() || '(brak)').slice(0, 2000) + String.fromCharCode(10) + String.fromCharCode(10) + 'NOWA ZASADA:' + String.fromCharCode(10) + String(skill).slice(0, 1500) }
      ];
      const verdict = await this.evolver.getCompletion(check);
      const vs = String(verdict || '');
      const a = vs.indexOf('{');
      const b = vs.lastIndexOf('}');
      if (a !== -1 && b > a) { const obj = JSON.parse(vs.slice(a, b + 1)); verified = !!(obj && obj.ok === true); if (!verified) { console.log('[Evolver] Odrzucono zasade: ' + String((obj && obj.powod) || '')); } }
    } catch (error) { verified = false; }
    if (!verified) { return; }
    this.memory.saveFact(`skill_${Date.now()}`, skill);
    this.saveSkill(skill);
  }
}
