import CryptoJS from 'crypto-js';
import * as fs from 'fs/promises';
import * as path from 'path';

export class SecretManager {
  private encryptionKey: string;
  private secretsFile: string;
  private secrets: Map<string, string> = new Map();

  constructor(secretsDir: string = '.omni/secrets') {
    this.encryptionKey = process.env.OMNI_ENCRYPTION_KEY || this.generateDefaultKey();
    this.secretsFile = path.join(secretsDir, 'encrypted-secrets.json');
  }

  /**
   * Generuje domyślny klucz szyfrowania (tylko do developmentu!).
   */
  private generateDefaultKey(): string {
    console.warn('[SecretManager] ⚠️  Używanie domyślnego klucza szyfrowania. Ustaw OMNI_ENCRYPTION_KEY w produkcji!');
    return 'default-dev-key-change-in-production-32chars!';
  }

  /**
   * Inicjalizuje SecretManager i ładuje istniejące sekrety.
   */
  public async initialize(): Promise<void> {
    const dir = path.dirname(this.secretsFile);
    await fs.mkdir(dir, { recursive: true });

    try {
      const data = await fs.readFile(this.secretsFile, 'utf-8');
      const encrypted = JSON.parse(data);
      
      for (const [key, value] of Object.entries(encrypted)) {
        const decrypted = this.decrypt(value as string);
        this.secrets.set(key, decrypted);
      }

      console.log(`[SecretManager] Załadowano ${this.secrets.size} sekretów`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[SecretManager] Błąd ładowania sekretów:', error.message);
      }
    }
  }

  /**
   * Szyfruje wartość.
   */
  private encrypt(value: string): string {
    return CryptoJS.AES.encrypt(value, this.encryptionKey).toString();
  }

  /**
   * Deszyfruje wartość.
   */
  private decrypt(encrypted: string): string {
    const bytes = CryptoJS.AES.decrypt(encrypted, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  /**
   * Zapisuje sekret (szyfruje i zapisuje do pliku).
   */
  public async setSecret(key: string, value: string): Promise<void> {
    const encrypted = this.encrypt(value);
    this.secrets.set(key, value);

    // Zapisz wszystkie sekrety do pliku
    const allEncrypted: Record<string, string> = {};
    for (const [k, v] of this.secrets) {
      allEncrypted[k] = this.encrypt(v);
    }

    await fs.writeFile(this.secretsFile, JSON.stringify(allEncrypted, null, 2), 'utf-8');
    console.log(`[SecretManager] Zapisano sekret: ${key}`);
  }

  /**
   * Pobiera sekret (deszyfruje).
   */
  public getSecret(key: string): string | undefined {
    return this.secrets.get(key);
  }

  /**
   * Usuwa sekret.
   */
  public async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);

    const allEncrypted: Record<string, string> = {};
    for (const [k, v] of this.secrets) {
      allEncrypted[k] = this.encrypt(v);
    }

    await fs.writeFile(this.secretsFile, JSON.stringify(allEncrypted, null, 2), 'utf-8');
    console.log(`[SecretManager] Usunięto sekret: ${key}`);
  }

  /**
   * Lista wszystkich kluczy sekretów (bez wartości).
   */
  public listSecrets(): string[] {
    return Array.from(this.secrets.keys());
  }

  /**
   * Generuje bezpieczny token API.
   */
  public generateApiToken(): string {
    const bytes = CryptoJS.lib.WordArray.random(32);
    return bytes.toString(CryptoJS.enc.Hex);
  }

  /**
   * Waliduje token API (porównuje z zapisanym).
   */
  public validateApiToken(token: string, expectedKey: string): boolean {
    const expected = this.getSecret(expectedKey);
    if (!expected) return false;
    
    // Time-safe comparison
    if (token.length !== expected.length) return false;
    
    let result = 0;
    for (let i = 0; i < token.length; i++) {
      result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    
    return result === 0;
  }
}

// Singleton instance
let secretManagerInstance: SecretManager | null = null;

export function getSecretManager(): SecretManager {
  if (!secretManagerInstance) {
    secretManagerInstance = new SecretManager();
  }
  return secretManagerInstance;
}
