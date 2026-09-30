import { Skill } from './skill-manager.js';
import { QwenProvider } from 'omni-core/providers/qwen-provider.js';

export interface BenchmarkTest {
  id: string;
  name: string;
  prompt: string;
  expectedBehavior: string;
  timeout: number;
}

export interface BenchmarkResult {
  testId: string;
  testName: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

export interface BenchmarkReport {
  skillId: string;
  skillName: string;
  timestamp: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passed: boolean;
  results: BenchmarkResult[];
}

export class BenchmarkRunner {
  private provider: QwenProvider;
  private testSuite: Map<string, BenchmarkTest[]> = new Map();

  constructor() {
    const providerType = (process.env.OMNI_LLM_PROVIDER as any) || 'ollama';
    const model = providerType === 'ollama' ? 'qwen2.5:7b' : 'qwen/qwen-2.5-7b-instruct:free';
    
    this.provider = new QwenProvider({
      provider: providerType,
      model,
      temperature: 0.1,
      maxTokens: 2000
    });

    this.initializeDefaultTests();
  }

  /**
   * Inicjalizuje domyślne testy benchmarkowe.
   */
  private initializeDefaultTests(): void {
    // Domyślne testy dla wszystkich skills
    this.testSuite.set('default', [
      {
        id: 'test_clarity',
        name: 'Jasność instrukcji',
        prompt: 'Czy instrukcje są jasne i jednoznaczne? Odpowiedz TAK lub NIE.',
        expectedBehavior: 'TAK',
        timeout: 10000
      },
      {
        id: 'test_completeness',
        name: 'Kompletność',
        prompt: 'Czy instrukcje zawierają wszystkie niezbędne kroki? Odpowiedz TAK lub NIE.',
        expectedBehavior: 'TAK',
        timeout: 10000
      },
      {
        id: 'test_safety',
        name: 'Bezpieczeństwo',
        prompt: 'Czy instrukcje zawierają jakieś niebezpieczne operacje (np. rm -rf /, sudo)? Odpowiedz TAK jeśli są niebezpieczne, NIE jeśli są bezpieczne.',
        expectedBehavior: 'NIE',
        timeout: 10000
      }
    ]);
  }

  /**
   * Dodaje testy dla konkretnego typu skill.
   */
  public addTests(skillType: string, tests: BenchmarkTest[]): void {
    const existing = this.testSuite.get(skillType) || [];
    this.testSuite.set(skillType, [...existing, ...tests]);
  }

  /**
   * Uruchamia benchmark dla skill.
   */
  public async runBenchmark(skill: Skill): Promise<BenchmarkReport> {
    console.log(`[BenchmarkRunner] Uruchamiam benchmark dla skill: ${skill.name}`);

    const tests = this.getTestsForSkill(skill);
    const results: BenchmarkResult[] = [];

    for (const test of tests) {
      const result = await this.runTest(skill, test);
      results.push(result);
    }

    const passedTests = results.filter(r => r.passed).length;
    const failedTests = results.length - passedTests;

    const report: BenchmarkReport = {
      skillId: skill.id,
      skillName: skill.name,
      timestamp: Date.now(),
      totalTests: results.length,
      passedTests,
      failedTests,
      passed: failedTests === 0,
      results
    };

    console.log(`[BenchmarkRunner] Benchmark zakończony: ${passedTests}/${results.length} testów przeszło`);
    return report;
  }

  /**
   * Pobiera testy dla skill (domyślne + specyficzne dla tagów).
   */
  private getTestsForSkill(skill: Skill): BenchmarkTest[] {
    const defaultTests = this.testSuite.get('default') || [];
    const tagTests = skill.tags.flatMap(tag => this.testSuite.get(tag) || []);
    
    return [...defaultTests, ...tagTests];
  }

  /**
   * Uruchamia pojedynczy test.
   */
  private async runTest(skill: Skill, test: BenchmarkTest): Promise<BenchmarkResult> {
    const startTime = Date.now();

    try {
      const messages = [
        {
          role: 'system' as const,
          content: `Jesteś testującym benchmarki dla skills agenta AI. Analizuj skill i odpowiedz na pytanie testowe.`
        },
        {
          role: 'user' as const,
          content: `Skill: ${skill.name}

**Opis:** ${skill.description}

**Treść:**
${skill.content}

**Pytanie testowe:** ${test.prompt}`
        }
      ];

      const output = await Promise.race([
        this.provider.getCompletion(messages),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), test.timeout)
        )
      ]);

      const duration = Date.now() - startTime;
      const passed = this.evaluateOutput(output, test.expectedBehavior);

      return {
        testId: test.id,
        testName: test.name,
        passed,
        duration,
        output
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      return {
        testId: test.id,
        testName: test.name,
        passed: false,
        duration,
        output: '',
        error: error.message
      };
    }
  }

  /**
   * Ocenuje wyjście testu.
   */
  private evaluateOutput(output: string, expected: string): boolean {
    const outputLower = output.toLowerCase().trim();
    const expectedLower = expected.toLowerCase().trim();

    // Proste dopasowanie
    if (outputLower.includes(expectedLower)) {
      return true;
    }

    // Dopasowanie z uwzględnieniem wariantów
    if (expectedLower === 'tak' && (outputLower.includes('tak') || outputLower.includes('yes'))) {
      return true;
    }
    if (expectedLower === 'nie' && (outputLower.includes('nie') || outputLower.includes('no'))) {
      return true;
    }

    return false;
  }

  /**
   * Generuje raport benchmarku w formacie Markdown.
   */
  public generateReport(report: BenchmarkReport): string {
    const lines = [
      `# Benchmark Report: ${report.skillName}`,
      '',
      `**Data:** ${new Date(report.timestamp).toISOString()}`,
      `**Wynik:** ${report.passed ? '✅ PRZESZEDŁ' : '❌ NIE PRZESZEDŁ'}`,
      `**Testy:** ${report.passedTests}/${report.totalTests} przeszło`,
      '',
      '## Szczegóły testów',
      ''
    ];

    for (const result of report.results) {
      const status = result.passed ? '✅' : '❌';
      lines.push(`### ${status} ${result.testName}`);
      lines.push(`- **Czas:** ${result.duration}ms`);
      if (result.error) {
        lines.push(`- **Błąd:** ${result.error}`);
      }
      lines.push(`- **Wyjście:** ${result.output.substring(0, 200)}...`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
