import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  successRate: number;
  metadata: Record<string, any>;
}

export class SkillManager {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private files: Map<string, string> = new Map();

  constructor(skillsDir: string = '.omni/skills') {
    this.skillsDir = skillsDir;
  }

  /**
   * Inicjalizuje katalog skills i ładuje istniejące skills.
   */
  public async initialize(): Promise<void> {
    await fs.mkdir(this.skillsDir, { recursive: true });
    await this.loadAllSkills();
    console.log(`[SkillManager] Załadowano ${this.skills.size} skills z ${this.skillsDir}`);
  }

  /**
   * Ładuje wszystkie skills z katalogu.
   */
  private async loadAllSkills(): Promise<void> {
    const files = await fs.readdir(this.skillsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      try {
        const skill = await this.loadSkillFromFile(path.join(this.skillsDir, file));
        if (skill) {
          this.skills.set(skill.id, skill);
          this.files.set(skill.id, file);
        }
      } catch (error: any) {
        console.error(`[SkillManager] Błąd ładowania skill ${file}:`, error.message);
      }
    }
  }

  /**
   * Ładuje pojedynczy skill z pliku Markdown z frontmatter.
   */
  private async loadSkillFromFile(filePath: string): Promise<Skill | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(content);

    if (!parsed.data.id || !parsed.data.name) {
      console.warn(`[SkillManager] Plik ${filePath} nie ma wymaganych pól w frontmatter`);
      return null;
    }

    return {
      id: parsed.data.id,
      name: parsed.data.name,
      description: parsed.data.description || '',
      content: parsed.content,
      tags: parsed.data.tags || [],
      createdAt: parsed.data.createdAt || Date.now(),
      updatedAt: parsed.data.updatedAt || Date.now(),
      usageCount: parsed.data.usageCount || 0,
      successRate: parsed.data.successRate || 1.0,
      metadata: parsed.data.metadata || {}
    };
  }

  /**
   * Tworzy nowy skill na podstawie analizy zadania.
   */
  public async createSkill(
    name: string,
    description: string,
    content: string,
    tags: string[] = [],
    metadata: Record<string, any> = {}
  ): Promise<Skill> {
    const skill: Skill = {
      id: uuidv4(),
      name,
      description,
      content,
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
      successRate: 1.0,
      metadata
    };

    await this.saveSkill(skill);
    this.skills.set(skill.id, skill);

    console.log(`[SkillManager] Utworzono nowy skill: ${name} (${skill.id})`);
    return skill;
  }

  /**
   * Zapisuje skill do pliku Markdown.
   */
  private async saveSkill(skill: Skill): Promise<void> {
    const frontmatter = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      usageCount: skill.usageCount,
      successRate: skill.successRate,
      metadata: skill.metadata
    };

    const fileContent = matter.stringify(skill.content, frontmatter);
    const slug = String(skill.name || skill.id || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const fileName = this.files.get(skill.id) || (slug + '.md');
    const filePath = path.join(this.skillsDir, fileName);

    await fs.writeFile(filePath, fileContent, 'utf-8');
    this.files.set(skill.id, fileName);
  }

  /**
   * Aktualizuje istniejący skill.
   */
  public async updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill nie znaleziony: ${skillId}`);
    }

    const updatedSkill: Skill = {
      ...skill,
      ...updates,
      updatedAt: Date.now()
    };

    await this.saveSkill(updatedSkill);
    this.skills.set(skillId, updatedSkill);

    console.log(`[SkillManager] Zaktualizowano skill: ${updatedSkill.name}`);
    return updatedSkill;
  }

  /**
   * Usuwa skill.
   */
  public async deleteSkill(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill nie znaleziony: ${skillId}`);
    }

    const fileName = `${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    const filePath = path.join(this.skillsDir, fileName);

    await fs.unlink(filePath);
    this.skills.delete(skillId);

    console.log(`[SkillManager] Usunięto skill: ${skill.name}`);
  }

  /**
   * Zwraca wszystkie skills.
   */
  public getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Znajduje skills pasujące do zapytania.
   */
  public findSkills(query: string, tags?: string[]): Skill[] {
    const queryLower = query.toLowerCase();
    
    return this.getAllSkills().filter(skill => {
      // Dopasowanie do nazwy lub opisu
      const matchesQuery = 
        skill.name.toLowerCase().includes(queryLower) ||
        skill.description.toLowerCase().includes(queryLower) ||
        skill.content.toLowerCase().includes(queryLower);

      // Dopasowanie do tagów (jeśli podane)
      const matchesTags = !tags || tags.length === 0 || 
        tags.some(tag => skill.tags.includes(tag));

      return matchesQuery && matchesTags;
    });
  }

  /**
   * Znajduje najlepsze skills dla danego zadania.
   */
  /** Tokenizacja: male litery, bez diakrytykow, po znakach niealfanumerycznych. */
  /** Synonimy PL/EN — rozszerzaja zapytanie bez embeddingow (waga 0.5 wobec oryginalu). */
  private expandQuery(tokens: string[]): Array<{ term: string, w: number }> {
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
    };
    const out = new Map<string, number>();
    for (const t of tokens) { if (!out.has(t)) { out.set(t, 1); } }
    for (const t of tokens) {
      for (const [k, vals] of Object.entries(syn)) {
        if (t.indexOf(k) !== -1 || vals.some((v) => t.indexOf(v) !== -1)) {
          if (!out.has(k)) { out.set(k, 0.5); }
          for (const v of vals) { if (!out.has(v)) { out.set(v, 0.5); } }
        }
      }
    }
    return Array.from(out.entries()).map(([term, w]) => ({ term: term, w: w }));
  }
  private tokenize(text: string): string[] {
    const map: Record<string, string> = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };
    const low = String(text || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => map[c] || c);
    return low.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  }

  /** BM25 po tresci skilli (zamiast prostego includes + successRate). */
  public findRelevantSkills(taskDescription: string, limit: number = 3): Skill[] {
    const skills = this.getAllSkills();
    if (!skills.length) { return []; }
    const docs = skills.map((s) => this.tokenize(s.name + ' ' + s.description + ' ' + s.tags.join(' ') + ' ' + s.content));
    const tagDocs = skills.map((s) => this.tokenize(s.tags.join(' ') + ' ' + s.name));
    const N = docs.length;
    const avgLen = (docs.reduce((a, d) => a + d.length, 0) / N) || 1;
    const df: Record<string, number> = {};
    for (const d of docs) {
      const seen: Record<string, boolean> = {};
      for (const t of d) { if (!seen[t]) { seen[t] = true; df[t] = (df[t] || 0) + 1; } }
    }
    const k1 = 1.5;
    const b = 0.75;
    const q = this.expandQuery(this.tokenize(taskDescription));
    const now = Date.now();
    const scored = skills.map((skill, i) => {
      const d = docs[i];
      const tf: Record<string, number> = {};
      for (const t of d) { tf[t] = (tf[t] || 0) + 1; }
      let score = 0;
      let tagHits = 0;
      for (const item of q) {
        const term = item.term;
        const f = tf[term] || 0;
        if (f) {
          const idf = Math.log(1 + (N - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5));
          score += item.w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.length / avgLen)));
        }
        if (tagDocs[i].indexOf(term) !== -1) { tagHits += item.w; }
      }
      // BOOST TAGOW: mnoznikowy i ograniczony (max +60%) - nie moze zdominowac BM25.
      if (tagHits > 0) { score *= 1 + Math.min(0.6, 0.2 * tagHits); }
      const sr = Math.max(0.1, Math.min(1, Number(skill.successRate) || 1));
      score *= 0.4 + 0.8 * sr;
      const ageDays = (now - (skill.updatedAt || skill.createdAt || now)) / 86400000;
      if (ageDays < 30) { score *= 1.05; }
      if ((skill.usageCount || 0) >= 3 && sr < 0.5) { score *= 0.6; }
      return { skill, score };
    });
    scored.sort((a, b2) => b2.score - a.score);
    const hit = scored.filter((x) => x.score > 0).map((x) => x.skill);
    const pool = hit.length ? hit : scored.map((x) => x.skill);
    return pool.slice(0, limit);
  }

  /** Prompt do reranku (mini-model wybiera najlepszych kandydatow z puli BM25). */
  public buildRerankPrompt(taskDescription: string, candidates: Skill[]): string {
    const lines = candidates.map((s, i) => (i + 1) + '. ' + s.name + ' - ' + String(s.description || '').slice(0, 120));
    return 'Zadanie: ' + taskDescription + String.fromCharCode(10) + 'Kandydaci:' + String.fromCharCode(10) + lines.join(String.fromCharCode(10)) + String.fromCharCode(10) + 'Zwroc WYLACZNIE numery najlepiej pasujacych (np. 2,5) albo 0 gdy zaden nie pasuje.';
  }

  /** Rerank: BM25 top-K -> mini-model wskazuje najlepsze. Bez modelu zwraca BM25. */
  public async findRelevantSkillsReranked(taskDescription: string, limit: number, reranker?: (prompt: string) => Promise<string>): Promise<Skill[]> {
    const pool = this.findRelevantSkills(taskDescription, Math.max(limit * 3, 6));
    if (!reranker || pool.length <= limit) { return pool.slice(0, limit); }
    try {
      const out = await reranker(this.buildRerankPrompt(taskDescription, pool));
      const nums = String(out || '').match(/[0-9]+/g) || [];
      const picked: Skill[] = [];
      for (const n of nums) { const idx = parseInt(n, 10) - 1; if (idx >= 0 && idx < pool.length && picked.indexOf(pool[idx]) === -1) { picked.push(pool[idx]); } if (picked.length >= limit) { break; } }
      if (picked.length) { return picked; }
      return pool.slice(0, limit);
    } catch (error) { return pool.slice(0, limit); }
  }

  /**
   * Zwiększa licznik użycia i aktualizuje success rate.
   */
  public async recordUsage(skillId: string, success: boolean): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    const newUsageCount = skill.usageCount + 1;
    const newSuccessRate = (skill.successRate * skill.usageCount + (success ? 1 : 0)) / newUsageCount;

    await this.updateSkill(skillId, {
      usageCount: newUsageCount,
      successRate: newSuccessRate
    });
  }

  /**
   * Zwraca skills posortowane według popularności.
   */
  public getTopSkills(limit: number = 10): Skill[] {
    return this.getAllSkills()
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * Zwraca skills z niskim success rate (do optymalizacji).
   */
  public getLowPerformingSkills(threshold: number = 0.7): Skill[] {
    return this.getAllSkills()
      .filter(skill => skill.successRate < threshold && skill.usageCount >= 3)
      .sort((a, b) => a.successRate - b.successRate);
  }
}
