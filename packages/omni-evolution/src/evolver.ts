import { QwenProvider } from 'omni-core/providers/qwen-provider.js';
import { SkillManager } from './skill-manager.js';
import { BenchmarkRunner } from './benchmark.js';
import { OmniMemory } from 'omni-memory/memory.js';

export interface TaskAnalysis {
  taskId: string;
  prompt: string;
  result: string;
  success: boolean;
  duration: number;
  toolsUsed: string[];
  iterations: number;
  error?: string;
  /** Optional metadata attached by the caller (e.g. the skill that produced it). */
  metadata?: Record<string, any>;
}

export interface EvolutionConfig {
  enabled: boolean;
  autoCreateSkills: boolean;
  minTaskDuration: number; // ms
  minSuccessRate: number;
  benchmarkBeforeApply: boolean;
  rollbackOnRegression: boolean;
}

export class Evolver {
  private skillManager: SkillManager;
  private benchmarkRunner: BenchmarkRunner;
  private memory: OmniMemory;
  private analyzer: QwenProvider;
  private config: EvolutionConfig;
  private evolutionHistory: TaskAnalysis[] = [];

  constructor(
    skillManager: SkillManager,
    benchmarkRunner: BenchmarkRunner,
    memory: OmniMemory,
    config: Partial<EvolutionConfig> = {}
  ) {
    this.skillManager = skillManager;
    this.benchmarkRunner = benchmarkRunner;
    this.memory = memory;
    
    this.config = {
      enabled: config.enabled ?? true,
      autoCreateSkills: config.autoCreateSkills ?? true,
      minTaskDuration: config.minTaskDuration ?? 5000,
      minSuccessRate: config.minSuccessRate ?? 0.8,
      benchmarkBeforeApply: config.benchmarkBeforeApply ?? true,
      rollbackOnRegression: config.rollbackOnRegression ?? true
    };

    const provider = (process.env.OMNI_LLM_PROVIDER as any) || 'ollama';
    const model = process.env.OMNI_LLM_MODEL
      || (provider === 'ollama' ? 'qwen2.5:1.5b' : 'qwen/qwen-2.5-7b-instruct:free');
    
    this.analyzer = new QwenProvider({
      provider,
      model,
      temperature: 0.3,
      maxTokens: 3000
    });
  }

  /**
   * Analizuje zakończone zadanie i decyduje, czy utworzyć nowy skill.
   */
  public async analyzeTask(analysis: TaskAnalysis): Promise<void> {
    if (!this.config.enabled) {
      console.log('[Evolver] Self-evolution jest wyłączone');
      return;
    }

    this.evolutionHistory.push(analysis);

    // Filtruj zadania, które są warte analizy
    if (!this.shouldAnalyze(analysis)) {
      console.log(`[Evolver] Zadanie ${analysis.taskId} nie spełnia kryteriów analizy`);
      return;
    }

    console.log(`[Evolver] Analizuję zadanie ${analysis.taskId}...`);

    try {
      // 1. Analiza zadania przez LLM
      const skillProposal = await this.proposeSkill(analysis);
      
      if (!skillProposal) {
        console.log(`[Evolver] Nie zaproponowano nowego skill dla zadania ${analysis.taskId}`);
        return;
      }

      // 2. Sprawdź, czy podobny skill już istnieje
      const existingSkills = this.skillManager.findRelevantSkills(skillProposal.name, 1);
      if (existingSkills.length > 0) {
        console.log(`[Evolver] Podobny skill już istnieje: ${existingSkills[0].name}`);
        await this.skillManager.recordUsage(existingSkills[0].id, analysis.success);
        return;
      }

      // 3. Utwórz nowy skill
      if (this.config.autoCreateSkills) {
        const newSkill = await this.skillManager.createSkill(
          skillProposal.name,
          skillProposal.description,
          skillProposal.content,
          skillProposal.tags,
          { sourceTaskId: analysis.taskId }
        );

        console.log(`[Evolver] Utworzono nowy skill: ${newSkill.name}`);

        // 4. Benchmark (opcjonalnie)
        if (this.config.benchmarkBeforeApply) {
          const benchmarkResult = await this.benchmarkRunner.runBenchmark(newSkill);
          
          if (!benchmarkResult.passed && this.config.rollbackOnRegression) {
            console.warn(`[Evolver] Benchmark nie przeszedł, usuwam skill: ${newSkill.name}`);
            await this.skillManager.deleteSkill(newSkill.id);
            return;
          }
        }

        // 5. Zapisz w pamięci
        this.memory.saveFact(`skill_created_${newSkill.id}`, JSON.stringify({
          name: newSkill.name,
          sourceTaskId: analysis.taskId,
          createdAt: Date.now()
        }));
      }

    } catch (error: any) {
      console.error(`[Evolver] Błąd analizy zadania ${analysis.taskId}:`, error.message);
    }
  }

  /**
   * Decyduje, czy zadanie powinno być analizowane.
   */
  private shouldAnalyze(analysis: TaskAnalysis): boolean {
    // Zadanie trwało wystarczająco długo
    if (analysis.duration < this.config.minTaskDuration) {
      return false;
    }

    // Zadanie użyło narzędzi (nie było trywialne)
    if (analysis.toolsUsed.length === 0) {
      return false;
    }

    // Zadanie było udane lub miało wystarczająco dużo iteracji
    if (!analysis.success && analysis.iterations < 3) {
      return false;
    }

    return true;
  }

  /**
   * Proponuje nowy skill na podstawie analizy zadania.
   */
  private async proposeSkill(analysis: TaskAnalysis): Promise<{
    name: string;
    description: string;
    content: string;
    tags: string[];
  } | null> {
    const messages = [
      {
        role: 'system' as const,
        content: `Jesteś Evolverem, modułem samodoskonalenia agenta AI. Twoim zadaniem jest analiza wykonanych zadań i tworzenie "skills" - krótkich instrukcji w formacie Markdown, które mogą być użyte w przyszłości do podobnych zadań.

Skill powinien zawierać:
1. Jasną nazwę (krótką, opisową)
2. Opis (kiedy używać tego skill)
3. Treść (krok po kroku, jak wykonać zadanie)
4. Tagi (kategorie)

Odpowiedz w formacie JSON:
{
  "name": "nazwa-skill",
  "description": "Kiedy używać tego skill",
  "content": "# Instrukcja\\n\\n1. Krok 1\\n2. Krok 2\\n...",
  "tags": ["tag1", "tag2"]
}

Jeśli zadanie nie nadaje się do stworzenia skill (jest zbyt proste, unikalne lub niepowtarzalne), odpowiedz: null`
      },
      {
        role: 'user' as const,
        content: `Analizuj to zadanie:

**Prompt użytkownika:**
${analysis.prompt}

**Wynik:**
${analysis.result.substring(0, 2000)}

**Czy zadanie było udane?** ${analysis.success ? 'Tak' : 'Nie'}
**Czas wykonania:** ${analysis.duration}ms
**Użyte narzędzia:** ${analysis.toolsUsed.join(', ')}
**Liczba iteracji:** ${analysis.iterations}
${analysis.error ? `**Błąd:** ${analysis.error}` : ''}

Czy to zadanie nadaje się do stworzenia reużywalnego skill? Jeśli tak, zaproponuj skill.`
      }
    ];

    const response = await this.analyzer.getCompletion(messages);
    
    try {
      // Spróbuj sparsować JSON z odpowiedzi
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.name || !parsed.content) {
        return null;
      }

      return {
        name: parsed.name,
        description: parsed.description || '',
        content: parsed.content,
        tags: parsed.tags || []
      };
    } catch (error) {
      console.error('[Evolver] Błąd parsowania propozycji skill:', error);
      return null;
    }
  }

  /**
   * Analizuje wszystkie skills i optymalizuje te z niskim performance.
   */
  public async optimizeLowPerformingSkills(): Promise<void> {
    const lowPerforming = this.skillManager.getLowPerformingSkills();
    
    if (lowPerforming.length === 0) {
      console.log('[Evolver] Brak skills z niskim performance');
      return;
    }

    console.log(`[Evolver] Znaleziono ${lowPerforming.length} skills do optymalizacji`);

    for (const skill of lowPerforming) {
      await this.optimizeSkill(skill);
    }
  }

  /**
   * Optymalizuje pojedynczy skill na podstawie historii użycia.
   */
  private async optimizeSkill(skill: any): Promise<void> {
    console.log(`[Evolver] Optymalizuję skill: ${skill.name} (success rate: ${skill.successRate})`);

    // Znajdź zadania, które używały tego skill
    const relatedTasks = this.evolutionHistory.filter(
      t => t.metadata?.skillId === skill.id || 
           t.prompt.toLowerCase().includes(skill.name.toLowerCase())
    );

    if (relatedTasks.length === 0) {
      console.log(`[Evolver] Brak historii użycia dla skill: ${skill.name}`);
      return;
    }

    // Analizuj nieudane zadania
    const failedTasks = relatedTasks.filter(t => !t.success);
    
    if (failedTasks.length === 0) {
      console.log(`[Evolver] Brak nieudanych zadań dla skill: ${skill.name}`);
      return;
    }

    // Poproś LLM o sugestie poprawek
    const messages = [
      {
        role: 'system' as const,
        content: 'Jesteś Evolverem. Analizuj nieudane zadania i zaproponuj poprawki do skill, aby zwiększyć jego skuteczność. Odpowiedz w formacie Markdown z poprawioną treścią skill.'
      },
      {
        role: 'user' as const,
        content: `Skill: ${skill.name}

**Obecna treść:**
${skill.content}

**Nieudane zadania:**
${failedTasks.slice(0, 3).map(t => `- Prompt: ${t.prompt}\n  Błąd: ${t.error || 'Brak'}\n`).join('\n')}

Zaproponuj poprawioną wersję skill.`
      }
    ];

    const improvedContent = await this.analyzer.getCompletion(messages);

    // Zaktualizuj skill
    await this.skillManager.updateSkill(skill.id, {
      content: improvedContent,
      metadata: {
        ...skill.metadata,
        lastOptimized: Date.now(),
        optimizationReason: `Poprawiono na podstawie ${failedTasks.length} nieudanych zadań`
      }
    });

    console.log(`[Evolver] Zoptymalizowano skill: ${skill.name}`);
  }

  /**
   * Zwraca statystyki evolution.
   */
  public getStats(): {
    totalTasksAnalyzed: number;
    skillsCreated: number;
    skillsOptimized: number;
    averageSuccessRate: number;
  } {
    const allSkills = this.skillManager.getAllSkills();
    const avgSuccessRate = allSkills.length > 0
      ? allSkills.reduce((sum, s) => sum + s.successRate, 0) / allSkills.length
      : 0;

    return {
      totalTasksAnalyzed: this.evolutionHistory.length,
      skillsCreated: allSkills.length,
      skillsOptimized: allSkills.filter(s => s.metadata?.lastOptimized).length,
      averageSuccessRate: avgSuccessRate
    };
  }

  /**
   * Czyści historię evolution (zachowuje skills).
   */
  public clearHistory(): void {
    this.evolutionHistory = [];
    console.log('[Evolver] Wyczyszczono historię evolution');
  }
}
