import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillManager } from './skill-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('SkillManager', () => {
  let skillManager: SkillManager;
  const testSkillsDir = '.omni/test-skills';

  beforeEach(async () => {
    skillManager = new SkillManager(testSkillsDir);
    await skillManager.initialize();
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testSkillsDir, { recursive: true, force: true });
    } catch {}
  });

  it('should create a new skill', async () => {
    const skill = await skillManager.createSkill(
      'test-skill',
      'Test description',
      '# Test content',
      ['test', 'example']
    );

    expect(skill).toBeDefined();
    expect(skill.name).toBe('test-skill');
    expect(skill.description).toBe('Test description');
    expect(skill.tags).toContain('test');
    expect(skill.usageCount).toBe(0);
    expect(skill.successRate).toBe(1.0);
  });

  it('should find skills by query', async () => {
    await skillManager.createSkill('git-commit', 'Commit changes', '# Git');
    await skillManager.createSkill('file-read', 'Read file', '# File');

    const found = skillManager.findSkills('git');
    expect(found.length).toBe(1);
    expect(found[0].name).toBe('git-commit');
  });

  it('should update skill usage', async () => {
    const skill = await skillManager.createSkill('test', 'Test', '# Test');
    
    await skillManager.recordUsage(skill.id, true);
    await skillManager.recordUsage(skill.id, true);
    await skillManager.recordUsage(skill.id, false);

    const updated = skillManager.getAllSkills().find(s => s.id === skill.id);
    expect(updated?.usageCount).toBe(3);
    expect(updated?.successRate).toBeCloseTo(0.667, 2);
  });

  it('should delete skill', async () => {
    const skill = await skillManager.createSkill('to-delete', 'Delete me', '# Delete');
    await skillManager.deleteSkill(skill.id);

    const found = skillManager.getAllSkills();
    expect(found.length).toBe(0);
  });
});
