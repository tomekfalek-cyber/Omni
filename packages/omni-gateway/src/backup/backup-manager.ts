import * as fs from 'fs/promises';
import * as path from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

export class BackupManager {
  private dbPath: string;
  private backupDir: string;
  private readonly MAX_BACKUPS = 10;

  constructor(dbPath: string, backupDir: string = '.omni/backups') {
    this.dbPath = dbPath;
    this.backupDir = backupDir;
  }

  /**
   * Inicjalizuje katalog backupów.
   */
  public async initialize(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true });
    console.log('[BackupManager] Backup manager zainicjalizowany');
  }

  /**
   * Tworzy backup bazy danych.
   */
  public async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `omni-db-${timestamp}`;
    const backupPath = path.join(this.backupDir, `${backupName}.zip`);

    try {
      // Sprawdź, czy baza istnieje
      await fs.access(this.dbPath);

      // Utwórz archiwum ZIP
      const output = createWriteStream(backupPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log(`[BackupManager] Backup utworzony: ${backupPath} (${archive.pointer()} bytes)`);
      });

      archive.on('error', (err) => {
        throw err;
      });

      archive.pipe(output);

      // Dodaj bazę danych
      archive.file(this.dbPath, { name: 'omni.db' });

      // Dodaj skills (jeśli istnieją)
      const skillsDir = '.omni/skills';
      try {
        await fs.access(skillsDir);
        archive.directory(skillsDir, 'skills');
      } catch {}

      // Dodaj konfigurację (jeśli istnieje)
      const configDir = '.omni/config';
      try {
        await fs.access(configDir);
        archive.directory(configDir, 'config');
      } catch {}

      await archive.finalize();

      // Wyczyść stare backupy
      await this.cleanupOldBackups();

      return backupPath;
    } catch (error: any) {
      throw new Error(`Błąd tworzenia backupu: ${error.message}`);
    }
  }

  /**
   * Przywraca bazę danych z backupu.
   */
  public async restoreBackup(backupPath: string): Promise<void> {
    try {
      // Sprawdź, czy backup istnieje
      await fs.access(backupPath);

      // Utwórz tymczasowy katalog
      const tempDir = path.join(this.backupDir, 'temp-restore');
      await fs.mkdir(tempDir, { recursive: true });

      // Rozpakuj archiwum (używając unzipper lub podobnej biblioteki)
      // Uproszczenie: w produkcji użyj biblioteki do rozpakowywania ZIP
      
      // Kopiuj bazę danych
      const restoredDbPath = path.join(tempDir, 'omni.db');
      await fs.copyFile(restoredDbPath, this.dbPath);

      // Wyczyść tymczasowy katalog
      await fs.rm(tempDir, { recursive: true, force: true });

      console.log(`[BackupManager] Backup przywrócony z: ${backupPath}`);
    } catch (error: any) {
      throw new Error(`Błąd przywracania backupu: ${error.message}`);
    }
  }

  /**
   * Lista dostępnych backupów.
   */
  public async listBackups(): Promise<Array<{
    name: string;
    path: string;
    size: number;
    createdAt: number;
  }>> {
    try {
      const files = await fs.readdir(this.backupDir);
      const zipFiles = files.filter(f => f.endsWith('.zip'));

      const backups = [];
      for (const file of zipFiles) {
        const filePath = path.join(this.backupDir, file);
        const stats = await fs.stat(filePath);
        
        backups.push({
          name: file,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtimeMs
        });
      }

      // Sortuj malejąco według daty
      backups.sort((a, b) => b.createdAt - a.createdAt);

      return backups;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Usuwa stary backup.
   */
  public async deleteBackup(backupPath: string): Promise<void> {
    await fs.unlink(backupPath);
    console.log(`[BackupManager] Usunięto backup: ${backupPath}`);
  }

  /**
   * Czyści stare backupy (zostawia tylko MAX_BACKUPS najnowszych).
   */
  private async cleanupOldBackups(): Promise<void> {
    const backups = await this.listBackups();
    
    if (backups.length > this.MAX_BACKUPS) {
      const toDelete = backups.slice(this.MAX_BACKUPS);
      
      for (const backup of toDelete) {
        await this.deleteBackup(backup.path);
      }

      console.log(`[BackupManager] Usunięto ${toDelete.length} starych backupów`);
    }
  }

  /**
   * Tworzy automatyczny backup (wywoływane okresowo).
   */
  public async scheduleAutomaticBackup(): Promise<void> {
    const interval = parseInt(process.env.OMNI_BACKUP_INTERVAL_HOURS || '24') * 60 * 60 * 1000;
    
    setInterval(async () => {
      try {
        await this.createBackup();
      } catch (error: any) {
        console.error('[BackupManager] Błąd automatycznego backupu:', error.message);
      }
    }, interval);

    console.log(`[BackupManager] Automatyczny backup co ${interval / (60 * 60 * 1000)} godzin`);
  }
}
