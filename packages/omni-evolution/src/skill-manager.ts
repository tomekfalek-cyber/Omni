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
    const fileName = `${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    const filePath = path.join(this.skillsDir, fileName);

    await fs.writeFile(filePath, fileContent, 'utf-8');
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
  public findRelevantSkills(taskDescription: string, limit: number = 3): Skill[] {
    const skills = this.findSkills(taskDescription);
    
    // Sortuj według success rate i usage count
    return skills
      .sort((a, b) => {
        const scoreA = a.successRate * Math.log(a.usageCount + 1);
        const scoreB = b.successRate * Math.log(b.usageCount + 1);
        return scoreB - scoreA;
      })
      .slice(0, limit);
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
