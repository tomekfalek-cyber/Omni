import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileTools } from './file-tools.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('FileTools', () => {
  let fileTools: FileTools;
  // Absolute so that the sandbox cwd and the requested path line up.
  const testDir = path.resolve(process.cwd(), '.omni/test-files');

  beforeEach(async () => {
    fileTools = new FileTools();
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should read file', async () => {
    const testFile = path.join(testDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello, World!');

    const content = await fileTools.readFile({ path: testFile }, testDir);
    expect(content).toBe('Hello, World!');
  });

  it('should write file', async () => {
    const testFile = path.join(testDir, 'output.txt');
    await fileTools.writeFile({ path: testFile, content: 'Test content' }, testDir);

    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('Test content');
  });

  it('should prevent path traversal', async () => {
    await expect(
      fileTools.readFile({ path: '../../../etc/passwd' }, testDir)
    ).rejects.toThrow('Naruszenie bezpieczeństwa');
  });

  it('should list files', async () => {
    await fs.writeFile(path.join(testDir, 'file1.txt'), '1');
    await fs.writeFile(path.join(testDir, 'file2.txt'), '2');

    const listing = await fileTools.listFiles({ path: testDir }, testDir);
    expect(listing).toContain('file1.txt');
    expect(listing).toContain('file2.txt');
  });
});
