import { QwenProvider } from 'omni-core/providers/qwen-provider.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Task, Message, AgentRole, ToolCall } from 'omni-core/types.js';
import { OmniMemory } from 'omni-memory/memory.js';
import { ToolRegistry } from 'omni-tools/registry.js';
import { v4 as uuidv4 } from 'uuid';
import { SkillManager } from 'omni-evolution';

export class SwarmManager {
  private planner: QwenProvider;
  private executor: QwenProvider;
  private executorStrong: QwenProvider;
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
    this.executorStrong = new QwenProvider({ provider, model: modelPro, temperature: 0.3, maxTokens: 4000 });
    this.reviewer = new QwenProvider({ provider, model: modelPro, temperature: 0.1, maxTokens: 2000 });
    this.evolver = new QwenProvider({ provider, model: modelFlash, temperature: 0.8, maxTokens: 3000 });
    this.coder = new QwenProvider({ provider, model: process.env.OMNI_LLM_MODEL_CODER || modelFlash, temperature: 0.2, maxTokens: 4000 });
    
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

    const fastMode = String(process.env.OMNI_FAST || '') === '1';
    const strongModel = fastMode ? modelFlash : (process.env.OMNI_LLM_MODEL_PLAN || process.env.OMNI_LLM_MODEL_CODER || ({ groq: 'openai/gpt-oss-120b', deepseek: 'deepseek-v4-pro', openrouter: 'qwen/qwen3.8-27b:free', gemini: 'gemini-flash-latest' } as any)[provider] || modelFlash);
    this.planner = new QwenProvider({ provider, model: strongModel, temperature: 0.4, maxTokens: 1400 });
    this.executor = new QwenProvider({ provider, model: modelFlash, temperature: 0.3, maxTokens: 1400 });
    this.executorStrong = new QwenProvider({ provider, model: strongModel, temperature: 0.3, maxTokens: 1400 });
    this.reviewer = new QwenProvider({ provider, model: strongModel, temperature: 0.1, maxTokens: 1200 });
    this.evolver = new QwenProvider({ provider, model: strongModel, temperature: 0.6, maxTokens: 900 });
    const coderByProvider: any = { groq: 'openai/gpt-oss-120b', deepseek: 'deepseek-v4-pro', openrouter: 'qwen/qwen3.8-27b:free', gemini: 'gemini-flash-latest' };
    const defaultCoder = coderByProvider[provider] || modelFlash;
    this.coder = new QwenProvider({ provider, model: process.env.OMNI_LLM_MODEL_CODER || defaultCoder, temperature: 0.2, maxTokens: 4000 });
    (this as any).modelMap = { provider, fastMode, strong: strongModel, flash: modelFlash, mini: modelMini, coder: process.env.OMNI_LLM_MODEL_CODER || defaultCoder };
    this.logEngine({ event: 'configure', engine: (this as any).modelMap });
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
  /** Sciezka do pliku pamieci projektu dla danego katalogu roboczego. */
  private projectMemoryFile(cwd: string): string {
    const safe = String(cwd || 'default').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(-60) || 'default';
    return path.join(os.homedir(), '.omni', 'memory', 'projects', safe + '.md');
  }
  /** Czyta pamiec projektu (per katalog roboczy). */
  private readProjectMemory(cwd: string): string {
    try {
      const f = this.projectMemoryFile(cwd);
      if (!fs.existsSync(f)) { return ''; }
      return fs.readFileSync(f, 'utf8').slice(-4000);
    } catch (e) { return ''; }
  }
  /** Czyta skumulowane lekcje z poprzednich zadan (pamiec, ktora sie kumuluje). */
  private readLessons(): string {
    try { const f = path.join(os.homedir(), '.omni', 'memory', 'lessons.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-2000) : ''; } catch (e) { return ''; }
  }
  /** Dopisuje krotka, unikalna lekcje do pamieci kumulatywnej. */
  private appendLesson(text: string): void {
    try {
      const f = path.join(os.homedir(), '.omni', 'memory', 'lessons.md');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const line = '- ' + String(text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
      let prev = ''; try { prev = fs.readFileSync(f, 'utf8'); } catch (e) { prev = ''; }
      if (prev.indexOf(line.slice(2, 60)) !== -1) { return; }
      fs.writeFileSync(f, prev + (prev && prev.slice(-1) !== String.fromCharCode(10) ? String.fromCharCode(10) : '') + line + String.fromCharCode(10), 'utf8');
      console.log('[Pamiec] Dodano lekcje: ' + line.slice(0, 80));
    } catch (e) { }
  }
  /** Czyta pamiec srodowiska (stack, porty, uslugi, pulapki). */
  private readEnvMemory(): string {
    try {
      const f = path.join(os.homedir(), '.omni', 'memory', 'environment.md');
      if (!fs.existsSync(f)) { return ''; }
      return fs.readFileSync(f, 'utf8').slice(-3000);
    } catch (e) { return ''; }
  }
  /** Zapamietuje male pliki projektu przed zadaniem koderskim (do cofniecia nieudanych zmian). */
  private snapshotProject(cwd: string): void {
    try {
      const exts = /\.(py|js|ts|tsx|jsx|json|md|txt|sh|html|css|sql|yml|yaml)$/i;
      const skip = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache', 'coverage']);
      const tmp = path.join(os.homedir(), '.omni', 'backups', Date.now().toString(36));
      fs.mkdirSync(tmp, { recursive: true });
      let total = 0; const copied: string[] = [];
      const walk = (dir: string, rel: string, depth: number) => {
        if (depth > 4 || total > 6000000 || copied.length > 800) { return; }
        let entries: any[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) as any[]; } catch (e) { return; }
        for (const en of entries) {
          if (total > 6000000 || copied.length > 800) { break; }
          if (skip.has(en.name)) { continue; }
          const full = path.join(dir, en.name);
          const r = rel ? rel + '/' + en.name : en.name;
          if (en.isDirectory()) { walk(full, r, depth + 1); continue; }
          if (!exts.test(en.name)) { continue; }
          try {
            const st = fs.statSync(full);
            if (!st.isFile() || st.size > 300000) { continue; }
            total += st.size;
            const dst = path.join(tmp, r);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(full, dst);
            copied.push(r);
          } catch (e) { }
        }
      };
      walk(cwd, '', 0);
      fs.writeFileSync(path.join(tmp, '_meta.json'), JSON.stringify({ cwd, files: copied }));
      (this as any).codeBackupDir = tmp;
    } catch (e) { (this as any).codeBackupDir = null; }
  }
  /** Przywraca pliki projektu z ostatniego snapshotu (cofa nieudane zmiany). */
  private restoreProject(): string[] {
    const tmp = (this as any).codeBackupDir; (this as any).codeBackupDir = null;
    if (!tmp) { return []; }
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(tmp, '_meta.json'), 'utf8'));
      const restored: string[] = [];
      for (const n of (meta.files || [])) { try { const dst = path.join(meta.cwd, n); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(tmp, n), dst); restored.push(n); } catch (e) { } }
      return restored;
    } catch (e) { return []; }
  }
  private behaviorRules(): string {
    const nl = String.fromCharCode(10);
    return [
      'ZASADY DZIALANIA (obowiazuja zawsze):',
      '1. Badz konkretny: po polsku, krotko, rzeczowo. Bez wstepow typu swietne pytanie.',
      '2. Zanim odpowiesz o faktach, plikach, cenach, pogodzie albo stanie czegokolwiek - UZYJ NARZEDZIA. Nie zgaduj.',
      '3. KAZDE twierdzenie o wykonanej pracy musi miec dowod (wynik komendy, sciezka pliku, kod HTTP). Brak dowodu = powiedz wprost, czego brakuje.',
      '4. MYSL KROK PO KROKU: najpierw ustal, JAK sprawdzisz sukces, potem dzialaj, na koncu sprawdz. To twoja najwazniejsza zasada.',
      '5. Praca lokalna jest DOZWOLONA bez pytania: zapisuj pliki, uruchamiaj komendy i testy, commituj w lokalnym repo. Pytaj TYLKO o dzialania na zewnatrz (wyslanie wiadomosci, publikacja, push do CUDZEGO repo). Nie uruchamiaj destrukcyjnych komend bez zgody.',
      '6. GDY NARZEDZIE ZWROCI BLAD: przeanalizuj blad i ZMIEN podejscie. NIGDY nie powtarzaj tej samej nieudanej komendy - po 2 takich samych bledach zmien narzedzie/argument albo powiedz wprost, co blokuje.',
      '7. Nie zakladaj, ze biblioteki sa zainstalowane. Uzywaj standardowej biblioteki (np. unittest zamiast pytest), a jesli naprawde potrzebujesz pakietu - najpierw sprawdz, czy jest, potem zainstaluj.',
      '8. MASZ PLAN od planera - wykonuj kroki PO KOLEI narzedziami. Nie pisz odpowiedzi koncowej przedwczesnie.',
      '9. Kod (TDD): najpierw test, potem kod, potem URUCHOM test i poprawiaj, az przejdzie. Nie koncz bez uruchomienia kodu. Przed oddaniem uruchom sprawdzenie skladni/typow (np. python3 -m py_compile, tsc --noEmit).',
      '10. Serwery i dlugo dzialajace procesy uruchamiaj ODLACZONE: setsid nohup node /sciezka/serwer.js > /home/openclaw/serwer.log 2>&1 & - inaczej zginą razem z powloka narzedzia.',
      '11. Nie mow, ze cos dziala, dopoki nie sprawdziles komenda (np. curl -sS -m 5 http://127.0.0.1:PORT/).',
      '12. Zlozone zadanie rozbij na kroki i po kazdym sprawdz wynik. Koncz albo wynikiem z dowodem, albo konkretna przeszkoda.',
      '13. Masz internet, pamiec, narzedzia i dzisiejsza date - nie wymyslaj ograniczen. Niepewny fakt najpierw sprawdz narzedziem.',
      '14. Formatuj czytelnie (naglowki, listy). Bez lania wody.',
      '15. ZMIANY SYSTEMOWE: zanim zmienisz konfiguracje/usluge/plik systemowy - NAJPIERW sprawdz obecny stan (odczyt), zrob kopie, zaplanuj, zmien, a potem SPRAWDZ dzialanie (curl/ps/log/hash). Nigdy nie nadpisuj konfiguracji bez kopii.',
      '16. WYBIERAJ WLASCIWE NARZEDZIE: procesy -> proc_inspect, porty -> net_summary, logi -> log_tail, hash pliku -> file_hash, mapa kodu -> code_map, Jira -> jira_*. NIE uzywaj shell_exec, gdy istnieje dedykowane narzedzie.',
      '17. DIAGNOZA JAK DETEKTYW: gdy cos zawiedzie (blad komendy/narzedzia) - (1) PRZECZYTAJ dokladnie TRESC bledu, (2) postaw JEDNA hipoteze przyczyny, (3) sprawdz ja jednym odczytem/testem, (4) dopiero potem zmieniaj. Nie naprawiaj po omacku.',
      '18. CLI (argparse): argumenty zaczynajace sie od "-" (np. wyrazenie "-5+3" albo sciezka "-plik") sa traktowane jak OPCJE. Pisz CLI odpornie: uzyj nargs=argparse.REMAINDER albo obslugi "--", i waliduj wejscie zamiast sie wywalac.',
      '19. BEZPIECZENSTWO: narzedzia audytowe/ofensywne (skanowanie, testy wstrzykniec, exploit) stosuj WYLACZNIE do systemow, ktore uzytkownik posiada lub ma pisemna zgode. Atakowanie cudzych systemow - ODMAWIAJ. W audycie najpierw inwentarz (passive), potem testy aktywne za zgoda.',
      '20. AUDYT/RAPORT z kodu lub repozytorium: najpierw zmierz (repo_audit, code_map), potem PRZECZYTAJ najwazniejsze pliki. Pisz szczery, konkretny raport z DOWODAMI (plik:linia albo liczba) - mocne strony, ryzyka z waga, tabela ocen, werdykt, priorytetowe poprawki. Bez pochlebstw i bez ogolnikow.',
      '21. RAPORT/AUDYT = CZYTAJ i PISZ, minimum dzialan: uzyj file_read, file_list, code_map, repo_audit, a wynik zapisz file_write. NIE uruchamiaj shell_exec/run_code i NIE zmieniaj plikow projektu - audyt niczego nie modyfikuje.',
      '22. NIEPRECYZYJNE POLECENIE: NIE odmawiaj i NIE odsylaj po szczegoly. Ustal najbardziej prawdopodobny ZAMIAR, przyjmij rozsadne zalozenia, WYKONAJ najlepsza interpretacje narzedziami i napisz 1 zdaniem, co zalozyles. Dopytaj TYLKO gdy brakuje danych krytycznych, ktorych nie da sie rozsadnie zalozyc. Ogolnikowosc polecenia to Twoja praca, nie powod do odmowy.',
      '23. KOLEJNOSC KROKOW: wykonuj kroki planu w kolejnosci ZALEZNOSCI (pole zalezy_od) - nie zaczynaj kroku, zanim jego zaleznosci nie sa gotowe. Po kazdym kroku sprawdz wynik.',
      '24. TESTY CUDZEGO PROJEKTU: gdy zmieniasz pliki w istniejacym projekcie, WYKRYJ i URUCHOM jego testy (npm test / pytest / python -m unittest / go test). Jesli testow nie ma - powiedz to wprost. Nie oddawaj zmiany bez uruchomienia testow, jesli istnieja.',
      '25. FINANSE/INWESTYCJE: jestes analitykiem, NIE licencjonowanym doradca inwestycyjnym. Dane bierz z narzedzi (crypto_price, news, web_search) - NIGDY nie zmyslaj cen, stop zwrotu ani wskaznikow; brak danych = powiedz to wprost. Rozdziel FAKTY (dane) od INTERPRETACJI i SCENARIUSZY; podawaj zalozenia, horyzont i ryzyko. Zakoncz KAZDA analize inwestycyjna zdaniem: "To analiza edukacyjna, nie personalna rekomendacja inwestycyjna." Nie obiecuj zyskow ani nie gwarantuj wynikow.',
      '26. KOD PRODUKCYJNY (standard): pisz kod gotowy na produkcje. Sekrety TYLKO z ENV (nigdy w kodzie). NIE wymyslaj API/endpointow/parametrow - brak pewnosci = sprawdz dokumentacje (web_fetch/web_search) albo napisz wprost "do weryfikacji". Zawsze obsluz: bledy (bez golego except), paginacje, limity/429 (backoff z Retry-After), wygasanie tokenow (refresh na 401), walidacje wejscia. Domyslnie tryb bezpieczny (dry-run) dla akcji zmieniajacych dane. Jasne nazwy, male funkcje, testy logiki. Zanim uznasz kod za gotowy - uruchom go/testy.',
      '27. DUZE PLIKI: NIE wysylaj ogromnej tresci w jednym wywolaniu (JSON sie urywa i plik wychodzi uszkodzony). Pisz przyrostowo: file_write (pierwsza czesc), potem file_append (kolejne czesci). Po zapisie zweryfikuj plik (file_read albo uruchom testy).',
    ].join(nl);
  }
  /** Niezalezna weryfikacja (bez modelu): uruchamia wykryte testy projektu. */
  private async verifyProjectTests(cwd: string): Promise<boolean> {
    try {
      let files: string[] = [];
      try { files = fs.readdirSync(cwd); } catch (e) { return false; }
      let cmd = '';
      const pyTests = files.filter((f) => /^test_.*\.py$/i.test(f) || /_test\.py$/i.test(f));
      if (pyTests.length) { cmd = 'python3 -m unittest discover -v 2>&1'; }
      else if (files.indexOf('package.json') !== -1) { cmd = 'npm test --silent 2>&1'; }
      if (!cmd) { return false; }
      const out = await this.execToolResilient('shell_exec', { command: cmd }, cwd);
      const s = String(typeof out === 'string' ? out : JSON.stringify(out));
      const ok = /(^|\n)OK\b/.test(s) || /\b[0-9]+ passed\b/i.test(s) || /all tests passed/i.test(s);
      console.log('[Swarm] Weryfikacja testow (niezalezna): ' + (ok ? 'OK' : 'FAIL') + ' :: ' + cmd);
      return ok;
    } catch (e) { return false; }
  }
  /** Petla TDD: uruchom kod/test, a przy bledzie popraw i uruchom ponownie (test -> poprawka -> retest). */
  private async codeTestFixLoop(prompt: string, cwd: string): Promise<string> {
    const NLx = String.fromCharCode(10);
    const toolSchemas = this.toolSchemas();
    let report = '';
    const msgs: any[] = [
      { role: 'system', content: 'Jestes Testerem kodu. URUCHOM wlasnie napisany kod lub test komenda (shell_exec albo run_code). Jesli testu nie ma, napisz krotki test i uruchom go. Zwroc DOKLADNIE: pierwsza linia "WYNIK: OK" albo "WYNIK: BLAD", a potem krotki powod. Wynik MUSI pochodzic z prawdziwego uruchomienia - nie zmyslaj.' },
      { role: 'user', content: 'Zadanie: ' + prompt + NLx + 'Katalog roboczy: ' + cwd },
    ];
    for (let round = 0; round < 2; round++) {
      const r1 = await this.executorTurn(msgs, toolSchemas, 'auto');
      const calls = r1.toolCalls || [];
      if (calls.length) {
        msgs.push({ role: 'assistant', content: r1.content || null, tool_calls: calls });
        for (const call of calls) {
          const nm = call.function && call.function.name;
          let ar: any = {};
          try { ar = this.parseArgs(call.function && call.function.arguments); } catch (e) { ar = {}; }
          try {
            const outp = await this.execToolResilient(nm, ar, cwd);
            msgs.push({ role: 'tool', tool_call_id: call.id, content: String(typeof outp === 'string' ? outp : JSON.stringify(outp)).slice(0, 6000) });
          } catch (e: any) {
            msgs.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + e.message });
          }
        }
      }
      const r2 = await this.executorTurn(msgs, toolSchemas, 'auto');
      report = String(r2.content || '');
      if (/WYNIK:\s*OK/i.test(report)) { return (round === 0 ? 'PASS_FIRST' : 'PASS_AFTER_FIX') + String.fromCharCode(10) + report; }
      if (!calls.length) { break; }
      msgs.push({ role: 'assistant', content: report });
      msgs.push({ role: 'user', content: 'Kod nie przeszedl. POPRAW plik(i) narzedziem file_write, uruchom ponownie i pokaz nowy wynik (pierwsza linia "WYNIK: OK" albo "WYNIK: BLAD").' });
    }
    return 'FAIL' + String.fromCharCode(10) + report;
  }
  /** Przeglad seniorski: ocen jakosc kodu i popraw realne problemy, potem uruchom testy. */
  private async codeReviewLoop(prompt: string, cwd: string): Promise<string> {
    const NLx = String.fromCharCode(10);
    const toolSchemas = this.toolSchemas();
    const msgs: any[] = [
      { role: 'system', content: 'Jestes SENIOR DEVELOPEREM z 20-letnim doswiadczeniem. Przeczytaj kod w katalogu roboczym (file_list, file_read). Ocen go pod katem: przypadki brzegowe, czytelnosc, nazwy, struktura, bezpieczenstwo, wydajnosc. Jesli znajdziesz REALNE problemy - POPRAW je narzedziem file_write i URUCHOM testy ponownie (shell_exec). Jesli kod jest dobry, odpowiedz dokladnie: "KOD: DOBRY". Nie zmieniaj dzialajacego kodu bez powodu.' },
      { role: 'user', content: 'Zadanie: ' + prompt + NLx + 'Katalog roboczy: ' + cwd },
    ];
    const r1 = await this.executorTurn(msgs, toolSchemas, 'auto');
    const calls = r1.toolCalls || [];
    if (!calls.length) { return String(r1.content || ''); }
    msgs.push({ role: 'assistant', content: r1.content || null, tool_calls: calls });
    for (const call of calls) {
      const nm = call.function && call.function.name;
      let ar: any = {};
      try { ar = this.parseArgs(call.function && call.function.arguments); } catch (e) { ar = {}; }
      try {
        const outp = await this.execToolResilient(nm, ar, cwd);
        msgs.push({ role: 'tool', tool_call_id: call.id, content: String(typeof outp === 'string' ? outp : JSON.stringify(outp)).slice(0, 6000) });
      } catch (e: any) {
        msgs.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + e.message });
      }
    }
    const r2 = await this.executorTurn(msgs, toolSchemas, 'auto');
    return String(r2.content || r1.content || '');
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
        name: 'skill_check',
        description: 'Self-test skilli: sprawdza poprawnosc procedur (frontmatter, tresc) i raportuje braki.',
        parameters: {},
        requiresApproval: false, timeoutMs: 8000, maxOutputBytes: 8000,
      },
      execute: async () => this.skillSelfTest(),
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
    this.tools.register({
      definition: { name: 'skill_drafts', description: 'Lista szkicow skilli (z porazek) czekajacych na akceptacje.', parameters: {}, requiresApproval: false, timeoutMs: 5000, maxOutputBytes: 6000 },
      execute: async () => this.listDrafts(),
    });
    this.tools.register({
      definition: { name: 'skill_accept', description: 'Akceptuje szkic skilla: przenosi z _drafts/ do aktywnych (po weryfikacji przez czlowieka).', parameters: { name: 'string' }, requiresApproval: false, timeoutMs: 5000, maxOutputBytes: 2000 },
      execute: async (args: any) => this.acceptDraft(String((args && args.name) || '')),
    });
    this.tools.register({
      definition: {
        name: 'project_remember',
        description: 'Zapisuje trwaly fakt o PROJEKCIE (stack, konwencje, decyzje, pulapki) do pamieci projektu. Podaj key i value.',
        parameters: { key: 'string', value: 'string' },
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 0,
      },
      execute: async (args: any) => {
        const key = String((args && args.key) || '').trim();
        const val = String((args && args.value) || '').trim();
        if (!key || !val) { throw new Error('Podaj key i value.'); }
        const f = this.projectMemoryFile((this as any).activeCwd || this.workspaceCwd);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const line = '- [' + new Date().toISOString().slice(0, 10) + '] ' + key + ': ' + val;
        let prev = '';
        try { prev = fs.readFileSync(f, 'utf8'); } catch (e) { prev = ''; }
        if (prev.indexOf(val) !== -1) { return 'Juz zapamietane: ' + key; }
        const sep = (prev && prev.slice(-1) !== String.fromCharCode(10)) ? String.fromCharCode(10) : '';
        fs.writeFileSync(f, prev + sep + line + String.fromCharCode(10), 'utf8');
        return 'Zapisano w pamieci projektu: ' + key;
      },
    });
    this.tools.register({
      definition: {
        name: 'project_read',
        description: 'Odczytuje pamiec projektu (stack, konwencje, decyzje, pulapki).',
        parameters: {},
        requiresApproval: false,
        timeoutMs: 5000,
        maxOutputBytes: 12000,
      },
      execute: async () => {
        const f = this.projectMemoryFile((this as any).activeCwd || this.workspaceCwd);
        try { return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-6000) : 'Pamiec projektu jest pusta.'; }
        catch (e) { return 'Blad odczytu pamieci projektu.'; }
      },
    });
    this.tools.register({
      definition: {
        name: 'env_remember',
        description: 'Zapisuje trwaly fakt o SRODOWISKU/maszynie (stack, porty, sciezki, uslugi, pulapki). Podaj key i value.',
        parameters: { key: 'string', value: 'string' },
        requiresApproval: false, timeoutMs: 5000, maxOutputBytes: 0,
      },
      execute: async (args: any) => {
        const key = String((args && args.key) || '').trim();
        const val = String((args && args.value) || '').trim();
        if (!key || !val) { throw new Error('Podaj key i value.'); }
        const f = path.join(os.homedir(), '.omni', 'memory', 'environment.md');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const line = '- [' + new Date().toISOString().slice(0, 10) + '] ' + key + ': ' + val;
        let prev = '';
        try { prev = fs.readFileSync(f, 'utf8'); } catch (err) { prev = ''; }
        if (prev.indexOf(val) !== -1) { return 'Juz zapamietane: ' + key; }
        const sep = (prev && prev.slice(-1) !== String.fromCharCode(10)) ? String.fromCharCode(10) : '';
        fs.writeFileSync(f, prev + sep + line + String.fromCharCode(10), 'utf8');
        return 'Zapisano w pamieci srodowiska: ' + key;
      },
    });
    this.tools.register({
      definition: {
        name: 'env_read',
        description: 'Odczytuje pamiec srodowiska (stack, porty, sciezki, uslugi, pulapki).',
        parameters: {},
        requiresApproval: false, timeoutMs: 5000, maxOutputBytes: 12000,
      },
      execute: async () => {
        const f = path.join(os.homedir(), '.omni', 'memory', 'environment.md');
        try { return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-6000) : 'Pamiec srodowiska jest pusta.'; }
        catch (e) { return 'Blad odczytu pamieci srodowiska.'; }
      },
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

  /** Odporne parsowanie argumentow narzedzia: JSON -> naprawa -> ekstrakcja pol. */
  private parseArgs(raw: any): any {
    if (raw && typeof raw === 'object') { return raw; }
    const s = String(raw || '').trim();
    if (!s) { return {}; }
    try { return JSON.parse(s); } catch (e) { }
    const t = s.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(t); } catch (e) { }
    let bal = 0;
    for (const ch of t) { if (ch === '{') { bal++; } else if (ch === '}') { bal--; } }
    if (bal > 0) { try { return JSON.parse(t + '}'.repeat(bal)); } catch (e) { } }
    const out: any = {};
    const pm = t.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (pm) { out.path = pm[1].replace(/\\"/g, '"').replace(/\n/g, String.fromCharCode(10)).replace(/\t/g, String.fromCharCode(9)); }
    // Bezpiecznie: NIE odzyskujemy 'content' (bywa uciety/zescapowany) - lepiej zwrocic blad i ponowic, niz zapisac zepsuty plik.
    if (Object.keys(out).length) { console.log('[Swarm] parseArgs: odzyskano tylko sciezke; content do ponowienia.'); }
    else { console.log('[Swarm] parseArgs: nie udalo sie odzyskac argumentow - narzedzie zglosi blad.'); }
    return out;
  }
  private async executorTurn(messages: any[], tools: any[], toolChoice?: string): Promise<{ content: string, toolCalls: any[] }> {
    (this as any).modelCalls = ((this as any).modelCalls || 0) + 1;
    let choice = toolChoice;
    if (choice === 'required' && /thinking|reason|deepseek-v4-pro|deepseek-reasoner/i.test(String(process.env.OMNI_LLM_MODEL || ''))) { choice = 'auto'; }
    const provider: any = this.pickProvider();
    if (typeof provider.getCompletionWithTools === 'function') {
      try {
        return await provider.getCompletionWithTools(messages, tools, choice);
      } catch (error: any) {
        console.log('[Swarm] Proba z tool_choice=' + String(toolChoice) + ' nieudana (' + error.message + ')');
        if (this.onEngineFailure && /429|rate limit|quota|limit token|tokenow|resource_exhausted|exhausted|overload|unavailable|503|401|invalid|authentication|unauthorized/i.test(String(error.message || ''))) { this.logEngine({ event: 'fallback', reason: String(error.message || '').slice(0, 160), engine: (this as any).engineUsed || null }); try { this.onEngineFailure(); } catch (e) { } }
        try {
          if (choice && choice !== 'auto') {
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

  /** Wybiera silnik: coder dla kodu/systemu, mocny dla realnych zadan, szybki (flash) dla krotkich. */
  private pickProvider(): QwenProvider {
    if (((this as any).useCoder || (this as any).useStrong) && this.coder) { (this as any).engineUsed = this.engineTag(this.coder, 'coder'); return this.coder; }
    if ((this as any).quickTask) { (this as any).engineUsed = this.engineTag(this.executor, 'flash'); this.logEngine({ event: 'downgrade', reason: 'quickTask (krotkie/latwe)', engine: (this as any).engineUsed }); return this.executor; }
    const p: QwenProvider = this.executorStrong || this.executor;
    (this as any).engineUsed = this.engineTag(p, p === this.executorStrong ? 'strong' : 'flash');
    if (!this.executorStrong) { this.logEngine({ event: 'downgrade', reason: 'brak mocnego silnika', engine: (this as any).engineUsed }); }
    return p;
  }
  /** Opis uzytego silnika (provider/model/rola). */
  private engineTag(p: any, role: string): any {
    const cfg: any = (p && (p as any).config) || {};
    return { provider: String(cfg.provider || process.env.OMNI_LLM_PROVIDER || ''), model: String(cfg.model || ''), role: role };
  }
  /** Etykieta silnika do panelu: "model @ provider [rola]". */
  private engineUsedLabel(): string {
    const e: any = (this as any).engineUsed;
    if (!e || !e.model) { return ''; }
    return String(e.model) + ' @ ' + String(e.provider || '') + ' [' + String(e.role || '') + ']';
  }
  /** Dziennik silnikow: konfiguracja i fallbacki (kiedy realna jakosc spada). */
  private logEngine(entry: Record<string, any>): void {
    try {
      const f = path.join(os.homedir(), '.omni', 'logs', 'engines.log');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.appendFileSync(f, new Date().toISOString() + ' ' + JSON.stringify(entry) + String.fromCharCode(10), 'utf8');
    } catch (e) { }
  }
  /** Normalizuje znaki pelnej szerokosci, ktorych niektore modele uzywaja w znacznikach narzedzi (｜＜＞). */
  private normalizeToolMarkers(s: string): string {
    return String(s || '')
      .split(String.fromCharCode(0xFF5C)).join('|')
      .split(String.fromCharCode(0xFF1C)).join('<')
      .split(String.fromCharCode(0xFF1E)).join('>')
      .split(String.fromCharCode(0xFF5E)).join('~');
  }
  private stripMarkers(text: string): string {
    let t = this.normalizeToolMarkers(String(text || ''))
      .split('[[DONE]]').join('')
      .split('[[APPROVED]]').join('')
      .split('[[REJECTED]]').join('')
      .split('[REJECTED BY REVIEWER]').join('');
    // Usun surowe znaczniki wywolan narzedzi, ktore potrafia wyciec do odpowiedzi (DSML/XML).
    t = t.replace(/<\/?\|[^>]*>/g, '');
    t = t.replace(/<\/?(?:invoke|parameter|tool_call|tool_calls|function_calls)(?:\s[^>]*)?>/gi, '');
    t = t.replace(/^\s*[<|]{1,3}\s*$/gm, '');
    t = t.replace(/\n{3,}/g, String.fromCharCode(10) + String.fromCharCode(10));
    return t.trim();
  }

  private parseToolCalls(text: string): Array<{ name: string, args: any }> {
    text = this.normalizeToolMarkers(String(text || ''));
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
    // Format 2: surowe znaczniki XML/DSML (invoke + parameter) - niektore modele tak je emituja.
    const invRe = /<\|?DSML\|?invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|?DSML\|?invoke>|<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/gi;
    let im;
    while ((im = invRe.exec(text)) !== null) {
      const nm = im[1] || im[3];
      const body = im[2] || im[4] || '';
      const a: any = {};
      const pRe = /<\|?DSML\|?parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|?DSML\|?parameter>|<parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/gi;
      let pm;
      while ((pm = pRe.exec(body)) !== null) { a[pm[1] || pm[3]] = String(pm[2] || pm[4] || '').trim(); }
      if (nm) calls.push({ name: nm, args: a });
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
    if ((this as any).useCoder) { return false; }
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
          try { args = this.parseArgs(call.function && call.function.arguments); } catch (e) { args = {}; }
          try {
            const output = await this.execToolResilient(name, args, cwd);
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

  /** Self-test skilli: sprawdza poprawnosc procedur (frontmatter + tresc). */
  private skillSelfTest(): string {
    try {
      const dir = path.join(os.homedir(), '.omni', 'skills');
      if (!fs.existsSync(dir)) { return 'Brak katalogu skilli.'; }
      const files = fs.readdirSync(dir).filter((f: string) => /\.md$/i.test(f) && !/^readme\.md$/i.test(f) && !/^_/.test(f));
      const good: string[] = []; const bad: string[] = [];
      for (const f of files) {
        const txt = fs.readFileSync(path.join(dir, f), 'utf8');
        const m = txt.match(/^---\s*\n([\s\S]*?)\n---/);
        const fm = m ? m[1] : '';
        const hasId = /(^|\n)id:\s*\S/.test(fm);
        const hasName = /(^|\n)name:\s*\S/.test(fm);
        const hasDesc = /(^|\n)description:\s*\S/.test(fm);
        const body = txt.replace(/^---[\s\S]*?---/, '').trim();
        const hasKiedy = /KIEDY:/i.test(txt);
        if (hasId && hasName && hasDesc && body.length > 30) { good.push(f + (hasKiedy ? '' : ' (brak KIEDY)')); }
        else { bad.push(f + ' [brak: ' + [!hasId && 'id', !hasName && 'name', !hasDesc && 'description', body.length <= 30 && 'tresc'].filter(Boolean).join(', ') + ']'); }
      }
      return 'SELF-TEST SKILLI: ' + good.length + '/' + files.length + ' OK' + String.fromCharCode(10) + 'Poprawne: ' + good.join(', ') + (bad.length ? String.fromCharCode(10) + 'Do poprawy: ' + bad.join('; ') : '');
    } catch (e: any) { return 'Blad self-testu skilli: ' + e.message; }
  }
  /** Leniwie tworzy i inicjalizuje SkillManager (JEDEN ranking skilli dla calego bota). */
  private async getSkillMgr(): Promise<any> {
    if ((this as any)._skillMgr !== undefined) { return (this as any)._skillMgr; }
    (this as any)._skillMgr = null;
    try {
      const m = new SkillManager(path.join(os.homedir(), '.omni', 'skills'));
      await m.initialize();
      (this as any)._skillMgr = m;
    } catch (e) { (this as any)._skillMgr = null; }
    return (this as any)._skillMgr;
  }
  /** Dopasowuje nazwe uzytego skilla do wpisu w SkillManager (id/slug/nazwa). */
  private skillIdFor(name: string): any {
    try {
      const m: any = (this as any)._skillMgr;
      if (!m) { return null; }
      const nm = String(name || '').trim().toLowerCase();
      const slug = nm.replace(new RegExp('[^a-z0-9]+', 'g'), '-').replace(new RegExp('^-+|-+$', 'g'), '');
      const all: any[] = m.getAllSkills();
      for (const s of all) {
        const sid = String(s.id || '').toLowerCase();
        if (sid === nm || sid === slug || String(s.name || '').toLowerCase() === nm || (slug && sid.indexOf(slug) !== -1)) { return s; }
      }
    } catch (e) { }
    return null;
  }
  /** #2: aktualizuje successRate/usageCount skilli, ktore faktycznie weszly w zadaniu. */
  private async recordSkillUsage(success: boolean): Promise<void> {
    const names: string[] = ((this as any).usedSkills || []).concat((this as any).injectedSkills || []);
    if (!names.length) { return; }
    try {
      await this.getSkillMgr();
      const m: any = (this as any)._skillMgr;
      if (!m) { return; }
      const seen: any = {};
      for (const nm of names) {
        const s = this.skillIdFor(nm);
        if (s && !seen[s.id]) { seen[s.id] = true; await m.recordUsage(s.id, success); }
      }
      const ids = Object.keys(seen);
      if (ids.length) { console.log('[Swarm] recordUsage: ' + ids.join(', ') + ' => ' + (success ? 'sukces' : 'porazka')); }
    } catch (e) { }
  }
  /** Ranking skilli przez SkillManager (JEDEN algorytm); awaryjnie ranker lokalny. */
  private rankSkillsForTask(task: string, limit: number): string {
    try {
      const m: any = (this as any)._skillMgr;
      if (m) {
        const skills = m.findRelevantSkills(task, limit);
        if (skills && skills.length) {
          (this as any).injectedSkills = (this as any).injectedSkills || [];
          for (const s of skills) { try { (this as any).injectedSkills.push(String(s.id)); } catch (e) { } }
          return skills.map((s: any) => '- ' + s.name + ' [skill_get: ' + s.id + ']' + (s.description ? ' - ' + String(s.description).slice(0, 90) : '')).join(String.fromCharCode(10));
        }
        return '';
      }
    } catch (e) { }
    return this.rankSkillsLocal(task, limit);
  }
  /** Awaryjny ranking lokalny (BM25-lite + synonimy) - gdy SkillManager niedostepny. */
  private rankSkillsLocal(task: string, limit: number): string {
    const nl = String.fromCharCode(10);
    try {
      const q = this.foldPl(String(task || '').toLowerCase());
      if (q.trim().length < 3) { return ''; }
      const dir = path.join(os.homedir(), '.omni', 'skills');
      if (!fs.existsSync(dir)) { return ''; }
      const files = fs.readdirSync(dir).filter((f: string) => f.slice(-3) === '.md' && f.toLowerCase() !== 'readme.md');
      if (!files.length) { return ''; }
      const syn: Record<string, string[]> = {
        port: ['nasluch', 'socket', 'ss', 'netstat', 'eaddrinuse'],
        log: ['blad', 'error', 'exception', 'traceback', 'journal'],
        proces: ['pid', 'cpu', 'ram', 'ps'],
        config: ['konfiguracj', 'ustawien', 'env', 'yaml'],
        api: ['endpoint', 'rest', 'fastapi', 'http'],
        jwt: ['token', 'auth', 'logowanie', 'haslo'],
        jira: ['ticket', 'zgloszen', 'sprint', 'board'],
        bezpieczen: ['security', 'owasp', 'hardening', 'sekret'],
        refaktor: ['modul', 'warstw', 'serwis'],
        panel: ['www', 'ui', 'dashboard', 'frontend', '7800'],
        deploy: ['wdrozenie', 'wypchnij', 'publish', 'release', 'wrangler'],
        stack: ['technologi', 'framework', 'bibliotek', 'narzedzi'],
        serwis: ['uslug', 'daemon', 'systemd'],
        baza: ['db', 'sqlite', 'sql', 'postgres', 'tabela'],
        kanal: ['channel', 'whatsapp', 'telegram', 'discord', 'sms'],
        mail: ['email', 'poczta', 'smtp', 'imap'],
        obraz: ['image', 'grafika', 'png', 'generuj'],
        test: ['testy', 'unittest', 'pytest', 'assert'],
      };
      const qtok = q.split(/[^a-z0-9]+/).filter((t: string) => t.length > 1);
      const qset = new Set<string>(qtok);
      const blocked = ['portfel', 'portal', 'import', 'raport', 'support', 'komponent'];
      for (const t of qtok) {
        if (blocked.indexOf(t) !== -1) { continue; }
        for (const k of Object.keys(syn)) {
          if (t.indexOf(k) !== -1 || syn[k].some((v) => t.indexOf(v) !== -1)) { qset.add(k); for (const v of syn[k]) { qset.add(v); } }
        }
      }
      const terms = Array.from(qset);
      const scored = files.map((f: string) => {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8');
        const low = this.foldPl(raw.slice(0, 1600).toLowerCase());
        const name = f.replace(/\.md$/i, '').toLowerCase();
        let score = 0;
        for (const term of terms) {
          const c = low.split(term).length - 1;
          if (c) { score += Math.min(4, c) * (term.length >= 4 ? 2 : 1); }
          if (name.indexOf(term) !== -1) { score += 3; }
        }
        const lineWhen = (raw.split(nl).filter((l: string) => l.indexOf('KIEDY:') === 0)[0] || '').replace('KIEDY: ', '');
        const lineTitle = (raw.split(nl).filter((l: string) => l.indexOf('# ') === 0)[0] || f).replace(/^#+ /, '');
        return { title: lineTitle, when: lineWhen, fn: f, score: score };
      }).sort((a: any, b2: any) => b2.score - a.score);
      const top = scored.filter((x: any) => x.score > 0).slice(0, limit);
      if (!top.length) { return ''; }
      return top.map((x: any) => '- ' + x.title + ' [skill_get: ' + x.fn.replace(/\.md$/i, '') + ']' + (x.when ? ' - ' + x.when : '')).join(nl);
    } catch (error) { return ''; }
  }
  /** Zapisuje porazke zadania i po 2 podobnych tworzy szkic skilla (do akceptacji, nieaktywny). */
  private noteFailure(prompt: string, reason: string): void {
    try {
      const dir = path.join(os.homedir(), '.omni');
      const f = path.join(dir, 'failures.json');
      let arr: any[] = [];
      try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { arr = []; }
      if (!Array.isArray(arr)) { arr = []; }
      const stem = this.foldPl(String(prompt || '').toLowerCase()).split(/[^a-z0-9]+/).filter((t: string) => t.length > 1).slice(0, 5).join('-');
      if (!stem) { return; }
      arr.push({ stem: stem, prompt: String(prompt || '').slice(0, 300), reason: String(reason || '').slice(0, 200), ts: Date.now() });
      if (arr.length > 200) { arr = arr.slice(arr.length - 200); }
      const count = arr.filter((x: any) => x && x.stem === stem).length;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f, JSON.stringify(arr), 'utf8');
      if (count >= 2) { this.draftSkill(stem, String(prompt || ''), String(reason || '')); }
    } catch (e) { }
  }
  /** Tworzy szkic skilla z powtarzajacej sie porazki - w _drafts/, do recznej akceptacji (nie auto-aktywny). */
  private draftSkill(stem: string, samplePrompt: string, reason: string): void {
    try {
      const dd = path.join(os.homedir(), '.omni', 'skills', '_drafts');
      fs.mkdirSync(dd, { recursive: true });
      const slug = ('draft-' + stem).slice(0, 60).replace(/-+$/, '');
      const file = path.join(dd, slug + '.md');
      if (fs.existsSync(file)) { return; }
      const title = String(samplePrompt || '').replace(/\s+/g, ' ').slice(0, 80);
      const nlc = String.fromCharCode(10);
      const body = [
        '---',
        'id: ' + slug,
        'name: Szkic: ' + title,
        'description: Szkic z porazek (' + reason.slice(0, 80) + ')',
        'tags: [draft, auto]',
        'successRate: 0.5',
        'usageCount: 0',
        '---',
        '# Szkic: ' + title,
        'KIEDY: zadanie "' + String(samplePrompt || '').slice(0, 140) + '" (powtorzona porazka)',
        'ZADANIE, KTORE 2x SIE NIE UDALO (' + reason.slice(0, 120) + '). Dopracuj kroki:',
        '1. Zdiagnozuj przyczyne porazki (przeczytaj blad, sprawdz hipoteze jednym testem).',
        '2. Zaplanuj minimalne kroki naprawy wg zaleznosci.',
        '3. Wykonaj i sprawdz wynik.',
        '',
      ].join(nlc);
      fs.writeFileSync(file, body, 'utf8');
      this.emit({ kind: 'writing', text: 'Utworzono szkic skilla (do akceptacji): ' + slug });
      console.log('[Swarm] Szkic skilla z 2x FAIL: ' + file);
    } catch (e) { }
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
        const titleLine = lines.filter((l: string) => l.indexOf('# ') === 0)[0] || f;
        const title = String(titleLine).replace(new RegExp('^#+ ', 'g'), '');
        const whenLine = lines.filter((l: string) => l.indexOf('KIEDY:') === 0)[0] || '';
        return '- ' + title + ' (' + whenLine.replace('KIEDY: ', '') + ')';
      }).join(nl);
    } catch (error) { return 'Blad odczytu skilli.'; }
  }

  /** Lista szkicow skilli czekajacych na akceptacje (z _drafts/). */
  private listDrafts(): string {
    const nl = String.fromCharCode(10);
    try {
      const dd = path.join(os.homedir(), '.omni', 'skills', '_drafts');
      if (!fs.existsSync(dd)) { return 'Brak szkicow.'; }
      const files = fs.readdirSync(dd).filter((f: string) => f.slice(-3) === '.md');
      if (!files.length) { return 'Brak szkicow.'; }
      return files.map((f: string) => {
        const raw = fs.readFileSync(path.join(dd, f), 'utf8');
        const t = (raw.split(nl).filter((l: string) => l.indexOf('# ') === 0)[0] || f).replace(/^#+ /, '');
        return '- ' + f.replace(/\.md$/, '') + ' :: ' + t;
      }).join(nl);
    } catch (e) { return 'Blad odczytu szkicow.'; }
  }
  /** Akceptuje szkic skilla: przenosi z _drafts/ do aktywnych, zdejmuje tag draft i ustawia id. */
  private acceptDraft(name: string): string {
    try {
      const dir = path.join(os.homedir(), '.omni', 'skills');
      const dd = path.join(dir, '_drafts');
      const rawIn = String(name || '').trim();
      if (!rawIn) { return 'Podaj nazwe szkicu (skill_drafts pokaze liste).'; }
      const cand = [rawIn, rawIn.replace(/\.md$/i, '') + '.md', 'draft-' + rawIn.replace(/\.md$/i, '') + '.md', 'draft-' + rawIn];
      let use = '';
      for (const c of cand) { const p = path.join(dd, c); if (fs.existsSync(p)) { use = p; break; } }
      if (!use) { return 'Nie znam szkicu: ' + rawIn; }
      const base = path.basename(use).replace(/^draft-/, '');
      const dst = path.join(dir, base);
      if (fs.existsSync(dst)) { return 'Skill juz istnieje (nie nadpisuje): ' + base; }
      let raw = fs.readFileSync(use, 'utf8');
      raw = raw.replace(/^id:\s*\S+/m, 'id: ' + base.replace(/\.md$/i, ''));
      raw = raw.replace(/tags:\s*\[([^\]]*)\]/, (m: string, inner: string) => 'tags: [' + inner.split(',').map((x: string) => x.trim()).filter((x: string) => x && x !== 'draft').join(', ') + ']');
      raw = raw.replace(/successRate:\s*[0-9.]+/, 'successRate: 1.0');
      fs.writeFileSync(dst, raw, 'utf8');
      fs.unlinkSync(use);
      return 'Zaakceptowano szkic -> aktywny skill: ' + base;
    } catch (e: any) { return 'Blad akceptacji: ' + e.message; }
  }
  private readSkill(name: string): string {
    try {
      ((this as any).usedSkills = (this as any).usedSkills || []).push(String(name || ''));
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
      const sum = this.readSessionSummary(sessionId);
      if (sum) { out = 'STRESZCZENIE WCZESNIEJSZEJ ROZMOWY:' + String.fromCharCode(10) + sum + String.fromCharCode(10) + String.fromCharCode(10) + 'OSTATNIE WYMIANY:' + String.fromCharCode(10) + out; }
      return out;
    } catch (error) { return ''; }
  }
  /** Aktualizuje zwiezle streszczenie dlugiej rozmowy (ciaglosc kontekstu). */
  private async updateSessionSummary(sessionId: string): Promise<void> {
    try {
      const recs: any[] = this.memory.recent(sessionId, 200) as any[];
      const turns = recs.filter((r: any) => r && (r.role === 'user' || r.role === 'assistant') && String(r.content || '').trim());
      if (turns.length < 12) { return; }
      const older = turns.slice(0, turns.length - 8);
      const text = older.map((r: any) => (r.role === 'user' ? 'U: ' : 'O: ') + String(r.content || '').slice(0, 300)).join(String.fromCharCode(10));
      if (text.length < 400) { return; }
      const sum = await this.executor.getCompletion([
        { role: 'system', content: 'Streszczasz rozmowe zwiezle (max 6 punktow): ustalenia, decyzje, wazne fakty o uzytkowniku i projekcie. Bez wstepow, bez powtorzen.' },
        { role: 'user', content: text.slice(0, 8000) },
      ]);
      const s = String(sum || '').trim();
      if (s.length < 20) { return; }
      const dir = path.join(os.homedir(), '.omni', 'summaries');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.md'), s.slice(0, 2000), 'utf8');
      console.log('[Pamiec] Zaktualizowano streszczenie rozmowy (' + s.length + ' znakow)');
    } catch (error) { }
  }
  /** Czyta streszczenie rozmowy (jesli jest). */
  private readSessionSummary(sessionId: string): string {
    try {
      const f = path.join(os.homedir(), '.omni', 'summaries', sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.md');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-1500) : '';
    } catch (e) { return ''; }
  }


  /** Klasyfikuje bledy narzedzi (taksonomia) i zapisuje wzorce. */
  /** Wykonuje narzedzie odpornie: przy bledzie zmienia strategie i ponawia (max 2x). */
  private async execToolResilient(name: string, args: any, cwd: string): Promise<string> {
    const attempts = 3;
    let lastMsg = '';
    let a: any = args;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const output = await this.tools.executeTool(name, a, cwd);
        if (attempt > 0) { console.log('[Swarm] Narzedzie ' + name + ' ok po probie ' + (attempt + 1)); }
        return typeof output === 'string' ? output : JSON.stringify(output);
      } catch (error: any) {
        lastMsg = String((error && error.message) || error);
        const kind = this.classifyToolError(lastMsg);
        if (attempt >= attempts - 1) { break; }
        if (kind === 'uprawnienia') { return 'BLOKADA (' + name + '): ' + lastMsg + ' - nie ponawiam, zmien podejscie.'; }
        if (kind === 'argumenty') { a = this.repairToolArgs(a); console.log('[Swarm] Blad argumentow ' + name + ' - poprawiam argumenty i ponawiam.'); continue; }
        if (kind === 'timeout') { console.log('[Swarm] Timeout ' + name + ' - ponawiam (proba ' + (attempt + 2) + ').'); continue; }
        console.log('[Swarm] Blad ' + name + ' (' + kind + ') - ponawiam (proba ' + (attempt + 2) + ').');
        await new Promise<void>((res) => setTimeout(res, 400 * (attempt + 1)));
      }
    }
    return 'BLAD (' + this.classifyToolError(lastMsg) + '): ' + lastMsg;
  }
  /** Prosta naprawa argumentow narzedzia: usuwa puste pola, zamienia obiekty na JSON. */
  private repairToolArgs(args: any): any {
    const out: any = {};
    if (args && typeof args === 'object') {
      for (const k of Object.keys(args)) {
        const v = (args as any)[k];
        if (v === undefined || v === null) { continue; }
        out[k] = (typeof v === 'object') ? JSON.stringify(v) : v;
      }
    }
    return out;
  }
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

  private readKnowledge(taskDescription?: string): string {
    const nl = String.fromCharCode(10);
    const task = String(taskDescription || (this as any).activePrompt || '');
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
      const projPath = path.join(dir, 'project.md');
      if (fs.existsSync(projPath)) {
        const proj = fs.readFileSync(projPath, 'utf8').slice(-2500);
        if (proj.trim().length > 10) { parts.push('PAMIEC PROJEKTU (stack, konwencje, decyzje, pulapki):' + nl + proj); }
      }
      const sdir = path.join(os.homedir(), '.omni', 'skills');
      if (fs.existsSync(sdir)) {
        const top = this.rankSkillsForTask(task, 3);
        if (top) { parts.push('TRAFNE SKILLE (uzyj skill_get po nazwe):' + nl + top); }
        else {
          const idx = this.listSkills();
          if (idx && idx.indexOf('Brak zapisanych') === -1) { parts.push('TWOJE SKILLE (procedury - uzyj skill_get, gdy zadanie pasuje):' + nl + idx); }
        }
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

  /** Deterministyczna lista plikow ("przygotuj liste plikow w <dir>") - zawsze uruchamia file_list. */
  private async tryDirectListFiles(prompt: string, cwd: string): Promise<string | null> {
    const low = this.foldPl(String(prompt || '').toLowerCase());
    const wantList = (/lista|liste|wykaz|spis|zawartosc/.test(low) && /plik|katalog|folder|dir/.test(low))
      || /\bls\b/.test(low)
      || /co jest w (katalogu|folderze|katalog|folder)/.test(low);
    if (!wantList) { return null; }
    let dir = cwd;
    const m = String(prompt || '').match(/(?:\/[A-Za-z0-9._-]+)+/);
    if (m && m[0]) { dir = m[0]; }
    const out = await this.execToolResilient('file_list', { path: dir }, cwd);
    const s = String(typeof out === 'string' ? out : JSON.stringify(out)).slice(0, 4000);
    return 'Pliki w ' + dir + ' (lista):' + String.fromCharCode(10) + s;
  }
  /** #4 Lekki scoring trudnosci zadania (dlugosc, wielokrokowosc, ciezkie czasowniki) - routing nie tylko po slowach. */
  /** #8 Jasny szablon blokady: co probowalem -> blad -> co Ty musisz zrobic. */
  private blockerText(what: string, err: string, todo: string): string {
    const nl = String.fromCharCode(10);
    return ['NIE UDALO SIE (blokada):', '- Co probowalem: ' + String(what || '').slice(0, 300), '- Blad: ' + String(err || '').slice(0, 300), '- Co musisz zrobic: ' + String(todo || 'sprawdz klucz API / limit / uprawnienia i sprobuj ponownie.')].join(nl);
  }
  private difficultyScore(prompt: string, folded: string): number {
    let s = 0;
    const len = String(prompt || '').trim().length;
    if (len > 180) { s += 1; }
    if (len > 400) { s += 1; }
    if (String(folded || '').indexOf(String.fromCharCode(10)) !== -1) { s += 1; }
    const heavy = ['zaplanuj', 'zaprojektuj', 'zoptymalizuj', 'przeanalizuj', 'porownaj', 'zbuduj', 'zaimplementuj', 'refaktor', 'napraw', 'wyjasnij', 'dlaczego', 'architektur', 'wydajnosc', 'strategi'];
    for (const h of heavy) { if (String(folded || '').indexOf(h) !== -1) { s += 1; break; } }
    return Math.min(s, 3);
  }
  private async executeTaskInner(sessionId: string, prompt: string, cwd: string): Promise<Task> {
    const taskId = uuidv4();
    (this as any).activeCwd = cwd;
    (this as any).activePrompt = String(prompt || '');
    (this as any).modelCalls = 0;
    (this as any).usedSkills = [];
    (this as any).injectedSkills = [];
    try { await this.getSkillMgr(); } catch (e) { }
    const trimmedLower = String(prompt).trim().toLowerCase();
    const exact = trimmedLower === '/dokladnie' || trimmedLower.indexOf('/dokladnie ') === 0;
    if (exact) { prompt = String(prompt).trim().slice('/dokladnie'.length).trim(); }
    const foldedTask = this.foldPl(String(prompt).toLowerCase());
    const codingKeys = ['napisz', 'kod', 'program', 'funkcj', 'klasa', 'implement', 'refaktor', 'debug', 'bug', 'endpoint', 'api', 'test', 'skrypt', 'aplikacj', 'modul', 'komponent', 'typescript', 'javascript', 'python'];
    let useCoder = false;
    for (const ck of codingKeys) { if (foldedTask.indexOf(ck) !== -1) { useCoder = true; break; } }
    const codeExtras = ['python', 'javascript', 'typescript', 'funkcj', 'metod', 'modul', 'bibliotek', 'algorytm', 'regex', ' sql', 'html', 'css', 'komponent', 'zoptymalizuj', 'napraw', 'debug', 'przetestuj', 'testy', 'blad', 'stworz', 'zbuduj', 'zapytani'];
    for (const ck of codeExtras) { if (foldedTask.indexOf(ck) !== -1) { useCoder = true; break; } }
    // AUDYT/RAPORT != kodowanie: zadanie "ocen/zaudytuj/raport" NIE moze wchodzic w TDD ani zmieniac plikow.
    const reportKeys = ['audyt', 'raport', 'ocen', 'przeglad', 'review', 'analiz', 'przeanalizuj', 'inspekcj', 'opini', 'recenzj'];
    const fixKeys = ['napraw', 'zaimplementuj', 'zrefaktoruj', 'wdroz', 'edytuj', 'napisz plik', 'stworz plik', 'zmien plik', 'dopisz', 'dodaj do pliku', 'popraw kod', 'popraw blad', 'popraw funkcj', 'dodaj funkcj'];
    let reportOnly = false;
    for (const rk of reportKeys) { if (foldedTask.indexOf(rk) !== -1) { reportOnly = true; break; } }
    if (reportOnly) { for (const fk of fixKeys) { if (foldedTask.indexOf(fk) !== -1) { reportOnly = false; break; } } }
    if (reportOnly) { useCoder = false; }
    const sysExtras = ['shell', 'log', 'proces', 'port', 'serwer', 'siec', 'network', 'diagnoz', 'debug', 'crash', 'wyciek', 'nasluch', 'cpu', 'ram', 'dysk', 'systemd', 'uslug', 'firewall', 'konfiguracj'];
    // #4 ROUTING PO TRUDNOSCI: lekki scoring - nie tylko slowa kluczowe.
    const diff = this.difficultyScore(prompt, foldedTask);
    (this as any).difficulty = diff;
    (this as any).useStrong = useCoder || diff >= 2;
    for (const sk of sysExtras) { if (foldedTask.indexOf(sk) !== -1) { (this as any).useStrong = true; break; } }
    if (reportOnly) { (this as any).useStrong = true; }
    // PRZYSPIESZENIE: krotkie, LATWE, nie-koderskie zadania nie placa za ciezki pipeline.
    const quickTask = !useCoder && !reportOnly && diff < 2 && String(prompt).trim().length < 180;
    (this as any).quickTask = quickTask;
    (this as any).useCoder = useCoder;
    if (useCoder || (this as any).useStrong) { this.snapshotProject(cwd); }
    const task: Task = {
      id: taskId,
      sessionId,
      prompt,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      iterations: 0,
      maxIterations: exact ? 20 : (useCoder ? (String(prompt).length > 300 ? Number(process.env.OMNI_MAX_ITERATIONS ?? 12) : 7) : Number(process.env.OMNI_MAX_ITERATIONS ?? 12)),
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
      (task as any).engine = this.engineUsedLabel();
      this.memory.appendTranscript(sessionId, 'assistant', directDate);
      task.updatedAt = Date.now();
      return task;
    }
    const directRem = this.tryDirectReminder(prompt);
    if (directRem) {
      try {
        const out = await this.execToolResilient('reminder_set', directRem, cwd);
        task.status = 'completed';
        task.result = String(typeof out === 'string' ? out : JSON.stringify(out));
        (task as any).engine = this.engineUsedLabel();
        this.memory.appendTranscript(sessionId, 'assistant', task.result);
      } catch (error: any) {
        task.status = 'failed';
        task.error = 'Nie udalo sie ustawic przypomnienia: ' + error.message;
      }
      task.updatedAt = Date.now();
      return task;
    }

    // Deterministyczna lista plikow: "przygotuj liste plikow w <dir>" zawsze uruchamia file_list.
    const directList = await this.tryDirectListFiles(prompt, cwd);
    if (directList) {
      task.status = 'completed';
      task.result = this.stripMarkers(directList);
      (task as any).engine = 'deterministyczne (file_list)';
      this.memory.appendTranscript(sessionId, 'assistant', task.result);
      task.updatedAt = Date.now();
      this.emit({ kind: 'done', text: '' });
      return task;
    }

    try {
      // KROK 1: Planner dekomponuje zadanie
      this.emit({ kind: 'thinking', text: 'Analizuje zadanie...' });
      let codeCtx = '';
      if (useCoder) {
        try {
          const cm = await this.execToolResilient('code_map', { path: '.', query: '' }, cwd);
          codeCtx = String(typeof cm === 'string' ? cm : JSON.stringify(cm)).slice(0, 4000);
          console.log('[Swarm] code_map: kontekst projektu ' + codeCtx.length + ' znakow');
        } catch (error: any) { codeCtx = ''; }
      }
      let sysCtx = '';
      if ((this as any).useStrong && !useCoder) {
        try {
          const nl2 = String.fromCharCode(10);
          const wantsLog = /log|blad|awari|crash|error|exception|traceback|wyjatek|stack/i.test(String(prompt));
          const tasks: Promise<any>[] = [
            this.execToolResilient('net_summary', {}, cwd),
            this.execToolResilient('proc_inspect', { filter: '' }, cwd),
          ];
          if (wantsLog) { tasks.push(this.execToolResilient('log_tail', { path: path.join(cwd, 'gateway.log'), lines: 30 }, cwd).catch(() => '')); }
          const res = await Promise.all(tasks);
          const ports = res[0]; const procs = res[1]; const logTail = res[2];
          sysCtx = 'STAN SYSTEMU (odczyt przed planem):' + nl2 + '--- PORTY ---' + nl2 + String(ports).slice(0, 1500) + nl2 + '--- PROCESY (top wg CPU) ---' + nl2 + String(procs).slice(0, 2000);
          if (logTail) { sysCtx += nl2 + '--- LOG (ostatnie linie) ---' + nl2 + String(logTail).slice(0, 1500); }
          console.log('[Swarm] inspect systemu: ' + sysCtx.length + ' znakow' + (wantsLog ? ' (z logiem)' : ''));
        } catch (error: any) { sysCtx = ''; }
      }
      const planCtx = codeCtx ? ('KONTEKST PROJEKTU (mapa kodu - uwzglednij strukture i zaleznosci plikow):' + String.fromCharCode(10) + codeCtx) : sysCtx;
      const plan = quickTask ? prompt : await this.runPlanner(planCtx ? (planCtx + String.fromCharCode(10) + String.fromCharCode(10) + prompt) : prompt, exact);
      this.memory.appendTranscript(sessionId, 'planner', `Plan: ${plan}`);

      // KROK 2: Executor wykonuje kroki
      let executionResult = '';
      let draftAnswer = '';
      let usedTools = false;
      let forceContinue = 0;
      let noProgress = 0;
      let fastAnswered = false;
      const execNames: string[] = [];
      let toolSchemas = this.toolSchemas();
      if (reportOnly) {
        const allow = new Set(['file_read', 'file_list', 'code_map', 'repo_audit', 'file_write', 'memory_search', 'memory_save', 'web_search', 'web_fetch', 'skill_get', 'skill_list']);
        toolSchemas = toolSchemas.filter((t: any) => allow.has(t.function && t.function.name));
        console.log('[Swarm] Tryb raportu: narzedzia ograniczone do ' + toolSchemas.length);
      }
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
        if (task.maxIterations > 1) { this.emit({ kind: 'thinking', text: 'Iteracja ' + (i + 1) + '/' + task.maxIterations }); }
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

        task.iterations = i + 1;
        const toolIntentKeys = ['obraz', 'grafika', 'grafik', 'obrazek', 'narysuj', 'rysunek', 'ilustracj', 'zdjec', 'foto', 'logo', 'ikon', 'plakat', 'generuj', 'przypomn', 'przypomni', 'wyslij', 'mail', 'email', 'log', 'proces', 'port', 'serwer', 'diagnoz', 'shell', 'siec', 'nasluch', 'cpu', 'ram', 'dysk', 'systemd', 'firewall', 'ogarnij', 'repo', 'repozytorium', 'projekt', 'przygotuj', 'zajmij', 'przejrzyj', 'zrob', 'wykonaj', 'napraw', 'popraw', 'dokoncz', 'zaplanuj', 'uporzadkuj', 'przeanalizuj', 'zbadaj', 'sprawdz'];
        let needsTool = false;
        for (const tk of toolIntentKeys) { if (String(prompt).toLowerCase().indexOf(tk) !== -1) { needsTool = true; break; } }
        if (i === 0 && !exact && !needsSearch && !isAction && !needsTool) {
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
          fastAnswered = true;
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
                const output = await this.execToolResilient(call.name, call.args, cwd);
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
        // #4 PARALLEL TOOLS: read-only narzedzia ida rownolegle, zapisy po kolei (bezpiecznie).
        const safeRead = new Set(['file_read', 'file_list', 'git_status', 'git_diff', 'web_search', 'web_fetch', 'crypto_price', 'news', 'code_map', 'proc_inspect', 'net_summary', 'log_tail', 'file_hash', 'memory_search', 'project_read', 'env_read', 'skill_list', 'skill_get', 'reminder_list', 'jira_search', 'jira_get_issue', 'jira_boards', 'jira_sprints', 'jira_report', 'github_api']);
        const parsed = toolCalls.map((call: any) => {
          const name = call.function && call.function.name;
          let args: any = {};
          try { args = this.parseArgs(call.function && call.function.arguments); } catch (error) { args = {}; }
          return { call: call, name: String(name), args: args };
        });
        const results: any[] = new Array(parsed.length);
        const readIdx: number[] = []; const serIdx: number[] = [];
        parsed.forEach((p: any, idx: number) => { (safeRead.has(p.name) ? readIdx : serIdx).push(idx); });
        if (readIdx.length > 1) {
          console.log('[Swarm] Rownolegle narzedzia (' + readIdx.length + '): ' + readIdx.map((i: number) => parsed[i].name).join(', '));
          this.emit({ kind: 'thinking', text: 'Rownolegle narzedzia: ' + readIdx.length });
          await Promise.all(readIdx.map(async (idx: number) => {
            const p = parsed[idx];
            try { this.emit({ kind: 'tool', text: p.name }); const output = await this.execToolResilient(p.name, p.args, cwd); results[idx] = { ok: true, name: p.name, text: typeof output === 'string' ? output : JSON.stringify(output) }; }
            catch (error: any) { results[idx] = { ok: false, name: p.name, text: 'BLAD (' + this.classifyToolError(error.message) + '): ' + error.message }; }
          }));
        } else { for (const idx of readIdx) { const p = parsed[idx]; try { this.emit({ kind: 'tool', text: p.name }); const output = await this.execToolResilient(p.name, p.args, cwd); results[idx] = { ok: true, name: p.name, text: typeof output === 'string' ? output : JSON.stringify(output) }; } catch (error: any) { results[idx] = { ok: false, name: p.name, text: 'BLAD (' + this.classifyToolError(error.message) + '): ' + error.message }; } } }
        for (const idx of serIdx) {
          const p = parsed[idx];
          try { console.log('[Swarm] Wykonuje narzedzie: ' + p.name); this.emit({ kind: 'tool', text: p.name }); const output = await this.execToolResilient(p.name, p.args, cwd); results[idx] = { ok: true, name: p.name, text: typeof output === 'string' ? output : JSON.stringify(output) }; }
          catch (error: any) { results[idx] = { ok: false, name: p.name, text: 'BLAD (' + this.classifyToolError(error.message) + '): ' + error.message }; }
        }
        for (let idx = 0; idx < parsed.length; idx++) {
          const p = parsed[idx]; const r = results[idx] || { ok: false, name: p.name, text: 'BLAD: brak wyniku' };
          usedTools = true;
          if (r.ok) { execNames.push(r.name); executionResult += r.text; messages.push({ role: 'tool', tool_call_id: p.call.id, content: this.compressToolOutput(r.text) }); this.memory.appendTranscript(sessionId, 'tool', r.name + ': ' + r.text.slice(0, 400)); }
          else { messages.push({ role: 'tool', tool_call_id: p.call.id, content: r.text }); }
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
        const toolCount = messages.filter((m: any) => m.role === 'tool').length;
        const synth = toolCount >= 3 ? ('SYNTEZA: masz ' + toolCount + ' wynikow narzedzi - polacz je w JEDNA spojna odpowiedz, podaj dowody (plik:linia, liczby, nazwy), nie powtarzaj surowych logow. ') : '';
        plain.push({ role: 'user', content: synth + 'Napisz teraz konkretna odpowiedz dla uzytkownika po polsku, NA PODSTAWIE WYNIKOW NARZEDZI powyzej. Jesli czegos nie udalo sie wykonac - powiedz to wprost i podaj konkretna blokade.' });
        let streamed = '';
        try {
          const provider: any = this.pickProvider();
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
              try { ar = this.parseArgs(call.function && call.function.arguments); } catch (e) { ar = {}; }
              try {
                const outp = await this.execToolResilient(nm, ar, cwd);
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
        if ((claimed || runningClaim) && !usedTools) {
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
              try { ar = this.parseArgs(call.function && call.function.arguments); } catch (e) { ar = {}; }
              try {
                const outp = await this.execToolResilient(nm, ar, cwd);
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
      // PETLA TDD: przy kodzie uruchom test i poprawiaj, az przejdzie (test -> poprawka -> retest).
      if (useCoder && usedTools) {
        try {
          this.emit({ kind: 'writing', text: 'Uruchamiam testy (TDD)...' });
          console.log('[Swarm] Petla TDD: test -> poprawka -> retest');
          const tddReport = await this.codeTestFixLoop(prompt, cwd);
          if (tddReport && tddReport.trim().length > 5) { executionResult = (executionResult ? executionResult + String.fromCharCode(10) : '') + 'TDD: ' + tddReport; }
          if (/^FAIL/.test(tddReport || '')) {
            const testsOk = await this.verifyProjectTests(cwd);
            if (testsOk) {
              console.log('[Swarm] TDD zglosilo FAIL, ale testy faktycznie przechodza - zachowuje zmiany.');
              executionResult = (executionResult ? executionResult + String.fromCharCode(10) : '') + 'TDD zglosilo FAIL, ale niezalezna weryfikacja: testy przechodza - zmiany zachowane.';
              (this as any).codeBackupDir = null;
            } else {
              const restored = this.restoreProject();
              if (restored.length) { executionResult = (executionResult ? executionResult + String.fromCharCode(10) : '') + 'WYCOFANO nieudane zmiany w plikach: ' + restored.join(', '); console.log('[Swarm] Wycofano nieudane zmiany: ' + restored.join(', ')); }
              this.emit({ kind: 'writing', text: 'Testy nie przeszly - wycofano zmiany w plikach.' });
            }
          } else {
            (this as any).codeBackupDir = null;
            if (!/^PASS_FIRST/.test(tddReport || '')) {
              this.emit({ kind: 'writing', text: 'Przeglad seniorski kodu...' });
              console.log('[Swarm] Przeglad seniorski kodu...');
              const review = await this.codeReviewLoop(prompt, cwd);
              if (review && review.trim().length > 5) { executionResult = (executionResult ? executionResult + String.fromCharCode(10) : '') + 'PRZEGLAD SENIORA: ' + review; }
            } else {
              console.log('[Swarm] Testy przeszly od razu - pomijam przeglad seniora (szybciej).');
            }
          }
        } catch (error: any) { console.log('[Swarm] Petla TDD/przeglad nieudane: ' + error.message); }
      }
      // REFLEKSJA: czy odpowiedz faktycznie rozwiazuje zadanie uzytkownika?
      if (!fastAnswered && !quickTask && draftAnswer && String(draftAnswer).trim().length > 200) {
        try {
          const refl = await this.executor.getCompletion([
            { role: 'system', content: 'Jestes Reflektorem. Patrzysz na ZADANIE i ODPOWIEDZ. Zwroc WYLACZNIE jedno: "OK" (odpowiedz rozwiazuje zadanie) albo "BRAK: <czego brakuje, 1 zdanie>". Nie przepisuj odpowiedzi, nie dodawaj nic wiecej.' },
            { role: 'user', content: 'ZADANIE: ' + prompt + String.fromCharCode(10) + String.fromCharCode(10) + 'ODPOWIEDZ: ' + String(draftAnswer).slice(0, 2000) },
          ]);
          const verdict = String(refl || '').trim();
          if (/^BRAK/i.test(verdict)) {
            console.log('[Swarm] Refleksja: ' + verdict.slice(0, 140) + ' -> wymuszam dokonczenie');
            executionResult = (executionResult ? executionResult + String.fromCharCode(10) : '') + 'REFLEKSJA (braki): ' + verdict;
            this.emit({ kind: 'writing', text: 'Dokanczam zadanie...' });
            for (let round = 0; round < 3; round++) {
              const cont: any[] = messages.concat([{ role: 'user', content: 'ZADANIE NIE JEST SKONCZONE (refleksja: ' + verdict.slice(0, 200) + '). DOKONCZ je TERAZ narzedziami - nie tlumacz sie i nie koncz samym tekstem. Wykonaj brakujace kroki (file_write/shell_exec) i uruchom testy.' }]);
              const r2 = await this.executorTurn(cont, toolSchemas, 'auto');
              const tc = r2.toolCalls || [];
              if (!tc.length) { const c2 = this.stripMarkers(r2.content); if (c2 && c2.trim().length > 5) { draftAnswer = c2; } break; }
              cont.push({ role: 'assistant', content: r2.content || null, tool_calls: tc });
              for (const call of tc) {
                const nm2 = call.function && call.function.name;
                let ar2: any = {}; try { ar2 = this.parseArgs(call.function && call.function.arguments); } catch (e) { ar2 = {}; }
                try { const o = await this.execToolResilient(nm2, ar2, cwd); const t = typeof o === 'string' ? o : JSON.stringify(o); executionResult += t; cont.push({ role: 'tool', tool_call_id: call.id, content: this.compressToolOutput(t) }); this.memory.appendTranscript(sessionId, 'tool', nm2 + ': ' + t.slice(0, 300)); }
                catch (e: any) { cont.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + e.message }); }
              }
            }
            console.log('[Swarm] Kontynuacja po refleksji: zakonczona');
          }
          else { console.log('[Swarm] Refleksja: OK'); }
        } catch (error) { }
      }
      // #5 PLAN-CHECKLIST: po toolach sprawdz, czy KAZDY krok planu ma pokrycie w wynikach.
      if (!fastAnswered && !quickTask && usedTools && plan && String(plan).split(String.fromCharCode(10)).filter((l: string) => l.trim().length > 3).length >= 2) {
        try {
          const chk = await this.executor.getCompletion([
            { role: 'system', content: 'Jestes Kontrolerem planu. Masz PLAN i WYNIKI NARZEDZI. Zwroc WYLACZNIE "OK" (kazdy krok planu ma pokrycie w wynikach) albo "BRAK: <kroki bez wyniku, 1 zdanie>". Nie przepisuj planu.' },
            { role: 'user', content: 'PLAN:' + String.fromCharCode(10) + plan + String.fromCharCode(10) + String.fromCharCode(10) + 'WYNIKI NARZEDZI:' + String.fromCharCode(10) + String(executionResult || '').slice(0, 3000) },
          ]);
          const v = String(chk || '').trim();
          if (/^BRAK/i.test(v)) {
            console.log('[Swarm] Plan-checklist: ' + v.slice(0, 140));
            executionResult = (executionResult ? executionResult + String.fromCharCode(10) : '') + 'PLAN-CHECKLIST (braki): ' + v;
            this.emit({ kind: 'writing', text: 'Domykam brakujace kroki planu...' });
            const contMsgs: any[] = messages.concat([{ role: 'user', content: 'PLAN-CHECKLIST wykryl braki: ' + v + ' Wykonaj brakujace kroki TERAZ narzedziami i podaj wynik.' }]);
            const cr = await this.executorTurn(contMsgs, toolSchemas, 'auto');
            const ccalls = cr.toolCalls || [];
            for (const call of ccalls) {
              const nm = call.function && call.function.name;
              let ar: any = {}; try { ar = this.parseArgs(call.function && call.function.arguments); } catch (e) { ar = {}; }
              try { const o = await this.execToolResilient(nm, ar, cwd); const t = typeof o === 'string' ? o : JSON.stringify(o); executionResult += t; } catch (e) { }
            }
            if (cr.content && String(cr.content).trim().length > 20) { draftAnswer = this.stripMarkers(String(cr.content)); }
          } else { console.log('[Swarm] Plan-checklist: OK'); }
        } catch (error) { }
      }
      // TOP4: self-critique (Krytyk) - tylko przy realnym ryzyku (kod albo uzyte narzedzia).
      if (!fastAnswered && draftAnswer && String(draftAnswer).trim().length > 20 && (useCoder || (usedTools && !quickTask))) {
        try {
          const crit = await this.executor.getCompletion([
            { role: 'system', content: ((this as any).useCoder ? 'Jestes takze Testerem: sprawdz kod pod katem bledow i uruchom test; jesli kod nie byl uruchomiony, zaznacz to wprost. ' : '') + 'Jestes SUROWYM Krytykiem faktow. Usun lub popraw KAZDE twierdzenie bez pokrycia w wynikach narzedzi. Nie dodawaj nic od siebie i nie chwal. Zwroc WYLACZNIE poprawiona odpowiedz po polsku.' },
            { role: 'user', content: 'Zadanie: ' + prompt + String.fromCharCode(10) + String.fromCharCode(10) + 'WYNIKI NARZEDZI (dowody):' + String.fromCharCode(10) + (String(executionResult || '').slice(0, 4000) || '(brak - narzedzia nie byly uzyte)') + String.fromCharCode(10) + String.fromCharCode(10) + 'Odpowiedz do sprawdzenia:' + String.fromCharCode(10) + String(draftAnswer).slice(0, 3000) },
          ]);
          const fixed = this.stripMarkers(crit);
          const criticDenied = /nie moge potwierdzic|brak dowod|nie mam dostepu do wynikow|nie mam wynikow narzedzi|nie wykonano|brak pokrycia|nie moge stwierdzic/i.test(norm(fixed || ''));
          if (fixed && fixed.trim().length > 5) {
            if (criticDenied && usedTools && String(executionResult || '').trim().length > 20) { console.log('[Swarm] Krytyk zanegowal odpowiedz mimo dowodow - zachowuje oryginal.'); }
            else { draftAnswer = fixed; }
          }
        } catch (error) { }
      }

      if (!draftAnswer || !String(draftAnswer).trim()) {
        draftAnswer = this.blockerText('wywolanie silnika (' + String(process.env.OMNI_LLM_PROVIDER || 'aktywny') + ') dla: ' + String(prompt).slice(0, 120), 'brak odpowiedzi modelu (klucz odrzucony albo limit darmowego planu)', 'sprawdz zakladke Klucze API (przycisk Sprawdz klucze) i sprobuj ponownie.');
        this.noteFailure(prompt, 'brak odpowiedzi silnika (klucz/limit)');
      }
      // KROK 4: Evolver uczy sie z zadania (opcjonalny - blad nie moze zepsuc odpowiedzi)
      if (!fastAnswered && !quickTask) { try { await this.runEvolver(prompt, executionResult); } catch (error) { } }
      if (!quickTask) { try { await this.updateSessionSummary(sessionId); } catch (error) { } }

      task.status = 'completed';
      this.memory.appendTranscript(sessionId, 'assistant', String(draftAnswer || '').slice(0, 2000));
      // Odpowiedź wykonawcy jest ważniejsza niż marudzenie reviewera.
      task.result = this.stripMarkers(String(draftAnswer || executionResult || ''));
      (task as any).engine = this.engineUsedLabel();
      if (!fastAnswered && !quickTask) { try { await this.harvestMemory(sessionId, prompt, String(draftAnswer || executionResult || '')); } catch (error) { } }
      this.memory.appendTranscript(sessionId, 'system', `Task completed: ${taskId}`);
    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      task.result = this.blockerText('realizacja zadania: ' + String(prompt).slice(0, 120), String(error.message || ''), 'sprawdz przyczyne powyzej (uprawnienia / klucz / limit) i sprobuj ponownie albo doprecyzuj zadanie.');
      (task as any).engine = this.engineUsedLabel();
      this.memory.appendTranscript(sessionId, 'system', `Task failed: ${error.message}`);
      try { this.noteFailure(prompt, String((error && error.message) || '')); } catch (e) { }
      try { await this.recordSkillUsage(false); } catch (e) { }
      if ((this as any).codeBackupDir) {
        const restored = this.restoreProject();
        if (restored.length) { console.log('[Swarm] Zadanie nieudane - wycofano zmiany w: ' + restored.join(', ')); }
      }
    }

    task.updatedAt = Date.now();
    try { await this.recordSkillUsage(task.status === 'completed'); } catch (e) { }
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
      (this.readProjectMemory(cwd) ? 'PAMIEC PROJEKTU (ustalenia z wczesniejszych sesji - korzystaj, nie pytaj ponownie):' + NL + this.readProjectMemory(cwd) : 'PAMIEC PROJEKTU: pusta (zapisuj ustalenia narzedziem project_remember)'),
      (this.readEnvMemory() ? 'PAMIEC SRODOWISKA (stack, porty, uslugi, pulapki - korzystaj):' + NL + this.readEnvMemory() : ''),
      (this.readLessons() ? 'LEKCJE Z POPRZEDNICH ZADAN (stosuj, nie powtarzaj bledow):' + NL + this.readLessons() : ''),
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
      { role: 'system' as const, content: ((this as any).useCoder ? 'Jestes takze Architektem: zaplanuj KOLEJNOSC plikow wg zaleznosci - najpierw moduly bez zaleznosci, potem te, ktore je importuja; w kazdym kroku podaj plik i od czego zalezy. ' : '') + 'Jestes WYLACZNIE Plannerem: nie wykonujesz krokow i nie odpowiadasz uzytkownikowi, tylko planujesz. Zwroc plan WYLACZNIE jako JSON (bez komentarzy): {"steps":[{"id":1,"opis":"...","sprawdzenie":"...","zalezy_od":[]}]}. Zasady: kazdy krok to jedna czynnosc wykonywalna narzedziem (file_write, file_read, shell_exec, web_search, web_fetch); pole sprawdzenie mowi jak potwierdzisz sukces; ostatni krok to weryfikacja calosci; od 3 do ' + (exact ? 10 : 8) + ' krokow; zalezy_od to lista id krokow wykonanych wczesniej. Nie wywoluj narzedzi. Jesli zadanie jest koderskie (pisanie/refaktor kodu), uwzglednij krok testu (napisz test albo uruchom istniejace testy) oraz krok weryfikacji (typecheck/lint). Katalog roboczy: ' + cwd + '.' },
      { role: 'user' as const, content: prompt }
    ];
    try {
      const pl: any = ((this as any).quickTask && this.executor) ? this.executor : this.planner;
      const raw = await pl.getCompletion(messages);
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
    this.appendLesson(String(skill));
  }
}
