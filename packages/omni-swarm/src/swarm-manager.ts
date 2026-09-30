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
      for (let i = 0; i < task.maxIterations; i++) {
        task.iterations = i + 1;
        const action = await this.runExecutor(plan, executionResult, cwd);
        
        const cleanedAction = action.replace(/\[\[(DONE|APPROVED|REJECTED)\]\]/g, '').trim();
        if (cleanedAction) draftAnswer = cleanedAction;

        if (action.includes('[[DONE]]')) {
          break;
        }

        // Brak wywołań narzędzi = to jest odpowiedź końcowa (szybka ścieżka dla pytań).
        if (!action.includes('[[CALL_TOOL')) {
          break;
        }

        // KROK 3: Reviewer weryfikuje
        const review = await this.runReviewer(prompt, plan, action, cwd);
        if (review.includes('[[APPROVED]]')) {
          break;
        } else {
          executionResult += '\n[REJECTED BY REVIEWER]: ' + review + '\nSpróbuj ponownie.';
        }
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

  private async runExecutor(plan: string, previousContext: string, cwd: string): Promise<string> {
    const messages = [
      { role: 'system' as const, content: `Jesteś Executorem. Masz dostęp do plików w: ${cwd}. Wykonaj następny krok z planu. Użyj składni [[CALL_TOOL:nazwa|{"arg":"wartosc"}]] aby wywołać narzędzie. Jeśli zadanie jest zakończone, napisz [[DONE]].` },
      { role: 'user' as const, content: `Plan:\n${plan}\n\nPoprzedni kontekst:\n${previousContext}` }
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
