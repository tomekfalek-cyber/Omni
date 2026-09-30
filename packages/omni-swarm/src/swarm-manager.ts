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
  }

  /** Przebudowuje silniki po zmianie klucza, dostawcy lub modelu w panelu. */
  public reconfigure(): void {
    const provider = (process.env.OMNI_LLM_PROVIDER as any) || 'ollama';
    const defaultFlash = provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen/qwen-2.5-7b-instruct:free';
    const defaultPro = provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen/qwen-2.5-coder-32b-instruct:free';
    const modelFlash = process.env.OMNI_LLM_MODEL || defaultFlash;
    const modelPro = process.env.OMNI_LLM_MODEL_PRO || modelFlash;

    this.planner = new QwenProvider({ provider, model: modelFlash, temperature: 0.7, maxTokens: 2000 });
    this.executor = new QwenProvider({ provider, model: modelFlash, temperature: 0.3, maxTokens: 4000 });
    this.reviewer = new QwenProvider({ provider, model: modelPro, temperature: 0.1, maxTokens: 2000 });
    this.evolver = new QwenProvider({ provider, model: modelFlash, temperature: 0.8, maxTokens: 3000 });
  }

  /** Krotkie zapytanie testowe do aktualnie ustawionego silnika. */
  public async ping(prompt: string): Promise<string> {
    const messages: any = [
      { role: 'system', content: 'Odpowiadaj krotko i po polsku.' },
      { role: 'user', content: prompt },
    ];
    return this.executor.getCompletion(messages);
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
      const plan = await this.runPlanner(prompt);
      this.memory.appendTranscript(sessionId, 'planner', `Plan: ${plan}`);

      // KROK 2: Executor wykonuje kroki
      let executionResult = '';
      let draftAnswer = '';
      let usedTools = false;

      for (let i = 0; i < task.maxIterations; i++) {
        task.iterations = i + 1;
        const action = await this.runExecutor(plan, executionResult, cwd, false);

        const calls = this.parseToolCalls(action);
        const cleanedAction = this.stripMarkers(action);

        if (calls.length === 0) {
          if (cleanedAction) draftAnswer = cleanedAction;
          break;
        }

        for (const call of calls) {
          usedTools = true;
          try {
            const output = await this.tools.executeTool(call.name, call.args, cwd);
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            executionResult += '\n[WYNIK NARZEDZIA ' + call.name + ']\n' + text + '\n';
            this.memory.appendTranscript(sessionId, 'tool', call.name + ': ' + text.slice(0, 400));
          } catch (error: any) {
            executionResult += '\n[BLAD NARZEDZIA ' + call.name + '] ' + error.message + '\n';
            this.memory.appendTranscript(sessionId, 'tool', 'BLAD ' + call.name + ': ' + error.message);
          }
        }

        const review = await this.runReviewer(prompt, plan, executionResult || action, cwd);
        if (!review.includes('[[APPROVED]]')) {
          executionResult += '\n[UWAGA REVIEWERA] ' + this.stripMarkers(review) + '\n';
        }
      }

      if (usedTools) {
        const finalAnswer = await this.runExecutor(plan, executionResult, cwd, true);
        const cleanedFinal = this.stripMarkers(finalAnswer);
        if (cleanedFinal) draftAnswer = cleanedFinal;
        const toolsUsed = this.parseToolCalls(executionResult).map(function (c) { return c.name; }).join(', ');
        this.memory.appendTranscript(sessionId, 'system', 'Uzyte narzedzia: ' + (toolsUsed || 'brak'));
      }
      // KROK 4: Evolver uczy się z zadania
      await this.runEvolver(prompt, executionResult);

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
    return task;
  }

  private async runPlanner(prompt: string): Promise<string> {
    const messages = [
      { role: 'system' as const, content: 'Jesteś Plannerem. Twoim zadaniem jest rozbić złożone polecenie użytkownika na maksymalnie 5 prostych, wykonywalnych kroków. Zwróć tylko listę kroków w formacie Markdown.' },
      { role: 'user' as const, content: prompt }
    ];
    return await this.planner.getCompletion(messages);
  }

  private async runExecutor(plan: string, previousContext: string, cwd: string, finalOnly: boolean = false): Promise<string> {
    const tools = this.tools.getAllDefinitions().map((t: any) => '- ' + t.name + ': ' + t.description).join('\n');
    const system = finalOnly
      ? 'Jestes Executorem. Nie wolno Ci wywolywac narzedzi. Na podstawie wynikow narzedzi napisz konkretna odpowiedz po polsku dla uzytkownika.'
      : 'Jestes Executorem i masz realne mozliwosci: czytanie i zapisywanie plikow, git oraz uruchamianie polecen. Katalog roboczy: ' + cwd + '. Dostepne narzedzia:\n' + tools + '\nAby wywolac narzedzie, napisz DOKLADNIE w osobnej linii: [[CALL_TOOL:nazwa|{\"argument\":\"wartosc\"}]] i nic wiecej. Jesli masz juz wynik, napisz gotowa odpowiedz po polsku, bez wywolywania narzedzi.';
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
