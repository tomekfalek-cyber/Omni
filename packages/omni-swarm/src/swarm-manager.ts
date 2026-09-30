import { QwenProvider } from 'omni-core/providers/qwen-provider.js';
import { Task, Message, AgentRole, ToolCall } from 'omni-core/types.js';
import { OmniMemory } from 'omni-memory/memory.js';
import { ToolRegistry } from 'omni-tools/registry.js';
import { v4 as uuidv4 } from 'uuid';

export class SwarmManager {
  private planner: QwenProvider;
  private executor: QwenProvider;
  private reviewer: QwenProvider;
  private evolver: QwenProvider;
  private memory: OmniMemory;
  public workspaceCwd: string = process.cwd();
  private tools: ToolRegistry;

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
  }

  /** Krotkie zapytanie testowe do aktualnie ustawionego silnika. */
  public async ping(prompt: string): Promise<string> {
    const messages: any = [
      { role: 'system', content: 'Odpowiadaj krotko i po polsku.' },
      { role: 'user', content: prompt },
    ];
    return this.executor.getCompletion(messages);
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
    const provider: any = this.executor;
    if (typeof provider.getCompletionWithTools === 'function') {
      try {
        return await provider.getCompletionWithTools(messages, tools, toolChoice);
      } catch (error: any) {
        console.log('[Swarm] Proba z tool_choice=' + String(toolChoice) + ' nieudana (' + error.message + ')');
        try {
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

  async executeTask(sessionId: string, prompt: string, cwd: string): Promise<Task> {
    const taskId = uuidv4();
    const task: Task = {
      id: taskId,
      sessionId,
      prompt,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      iterations: 0,
      maxIterations: Number(process.env.OMNI_MAX_ITERATIONS ?? 5),
      currentAgent: 'planner',
    };

    this.memory.appendTranscript(sessionId, 'system', `Task started: ${prompt}`);

    try {
      // KROK 1: Planner dekomponuje zadanie
      this.emit({ kind: 'thinking', text: 'Analizuje zadanie...' });
      const plan = await this.runPlanner(prompt);
      this.memory.appendTranscript(sessionId, 'planner', `Plan: ${plan}`);

      // KROK 2: Executor wykonuje kroki
      let executionResult = '';
      let draftAnswer = '';
      let usedTools = false;
      const toolSchemas = this.toolSchemas();
      const lowerPrompt = String(prompt).toLowerCase();
      const searchKeys = ['kurs', 'cena', 'ile kosztuje', 'walut', 'bitcoin', 'ethereum', 'krypto', 'wiadomosc', 'wydarzen', 'co sie dzieje', 'najnowsz', 'pogod', 'przepis', 'ugotowac', 'znajdz', 'sprawdz', 'wyszukaj', 'aktualn', 'kto ', 'gdzie ', 'kiedy ', 'jaki jest', 'jaka jest', 'ile '];
      let needsSearch = false;
      for (const key of searchKeys) { if (lowerPrompt.indexOf(key) !== -1) { needsSearch = true; break; } }
      const messages: any[] = [
        { role: 'system', content: this.capabilities(cwd) + String.fromCharCode(10) + 'WAZNE: gdy pytanie dotyczy faktow, kursow, wiadomosci, pogody, przepisow lub czegokolwiek z internetu - NAJPIERW wywolaj odpowiednie narzedzie. Nie odpowiadaj na takie pytania z pamieci.' },
        { role: 'user', content: 'Zadanie: ' + prompt + '\nPlan:\n' + plan },
      ];

      for (let i = 0; i < task.maxIterations; i++) {
        task.iterations = i + 1;
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
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            executionResult += text;
            messages.push({ role: 'tool', tool_call_id: call.id, content: text.slice(0, 8000) });
            this.memory.appendTranscript(sessionId, 'tool', name + ': ' + text.slice(0, 400));
          } catch (error: any) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + error.message });
          }
        }
      }

      if (usedTools) {
        this.emit({ kind: 'writing', text: 'Pisze odpowiedz...' });
        for (let attempt = 0; attempt < 3; attempt++) {
          messages.push({ role: 'user', content: attempt === 0 ? 'Na podstawie wynikow narzedzi napisz teraz konkretna odpowiedz dla uzytkownika po polsku.' : 'Napisz teraz sama odpowiedz dla uzytkownika po polsku.' });
          const finalResponse = await this.executorTurn(messages, toolSchemas);
          const finalCalls = finalResponse.toolCalls || [];
          if (!finalCalls.length) {
            const cleanedFinal = this.stripMarkers(finalResponse.content);
            if (cleanedFinal) { draftAnswer = cleanedFinal; }
            break;
          }
          messages.push({ role: 'assistant', content: finalResponse.content || null, tool_calls: finalCalls });
          for (const call of finalCalls) {
            const name = call.function && call.function.name;
            let args: any = {};
            try { args = JSON.parse((call.function && call.function.arguments) || '{}'); } catch (error) { args = {}; }
            try {
              const output = await this.tools.executeTool(name, args, cwd);
              const text = typeof output === 'string' ? output : JSON.stringify(output);
              executionResult += text;
              messages.push({ role: 'tool', tool_call_id: call.id, content: text.slice(0, 8000) });
            } catch (error: any) {
              messages.push({ role: 'tool', tool_call_id: call.id, content: 'BLAD: ' + error.message });
            }
          }
        }
      }
      // KROK 4: Evolver uczy sie z zadania (opcjonalny - blad nie moze zepsuc odpowiedzi)
      try { await this.runEvolver(prompt, executionResult); } catch (error) { }

      task.status = 'completed';
      // Odpowiedź wykonawcy jest ważniejsza niż marudzenie reviewera.
      task.result = draftAnswer || executionResult;
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
      'MASZ ROZMOWE GLOSOWA: uzytkownik moze mowic zamiast pisac.',
      'MASZ DOSTEP DO PLIKOW i POWLOKI na tym komputerze.',
      'MASZ GLOS: Twoje odpowiedzi mozna odczytac na glos (przycisk Czytaj), uzytkownik moze tez mowic do Ciebie przez mikrofon, a wlasne glosy da sie wgrywac. NIGDY nie pisz, ze nie mozesz mowic ani generowac dzwieku.',
      'MASZ GENEROWANIE OBRAZKOW: narzedzie image_generate tworzy grafike. Gdy ktos poprosi o obrazek, uzyj tego narzedzia i podaj w odpowiedzi adres /image/... - panel wyswietli obrazek.',
      'MASZ AUTOMATYZACJE: mozesz wykonywac zadania o wyznaczonych porach (zakladka Automatyzacje).',
      'ZASADY: nie zmyslaj danych - uzyj narzedzia. Na kursy krypto uzyj crypto_price, na biezace wydarzenia i wiadomosci uzyj news, na reszte web_search. Odpowiadaj po polsku, krotko i konkretnie.',
    ].join(NL);
  }
  private async runPlanner(prompt: string): Promise<string> {
    const cwd = this.workspaceCwd;
    const messages = [
      { role: 'system' as const, content: 'Jestes Plannerem. Rozbij zadanie uzytkownika na maksymalnie 4 proste kroki. Odpowiedz zwyklym tekstem. Nie wywoluj zadnych narzedzi. Katalog roboczy: ' + cwd + '.' },
      { role: 'user' as const, content: prompt }
    ];
    try {
      return await this.planner.getCompletion(messages);
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
      { role: 'system' as const, content: 'Jesteś Reviewerem. Oceniasz odpowiedź W KONTEKŚCIE zadania użytkownika. Proste odpowiedzi na pytania ZATWIERDZAJ. Jeśli naprawdę trzeba coś poprawić, odpowiedz [[REJECTED]] i podaj konkretny powód. Przy braku zastrzeżeń odpowiedz dokładnie [[APPROVED]].' },
      { role: 'user' as const, content: `Zadanie użytkownika:\n${originalPrompt}\n\nPlan:\n${plan}\n\nDo oceny:\n${action}\n\nKatalog roboczy: ${cwd}` }
    ];
    return await this.reviewer.getCompletion(messages);
  }

  private async runEvolver(originalPrompt: string, result: string): Promise<void> {
    // W pełnej implementacji: analizuje result i generuje plik .omni/skills/new_skill.md
    const messages = [
      { role: 'system' as const, content: 'Jesteś Evolverem. Na podstawie wykonanego zadania, stwórz krótką notatkę w formacie Markdown, która może być przydatna w przyszłości jako "skill".' },
      { role: 'user' as const, content: `Zadanie: ${originalPrompt}\nWynik: ${result}` }
    ];
    const skill = await this.evolver.getCompletion(messages);
    this.memory.saveFact(`skill_${Date.now()}`, skill);
  }
}
