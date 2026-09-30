import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SecretManager } from './security/secret-manager.js';

export type OmniProviderId = 'ollama' | 'openrouter';

export interface OmniConfig {
  provider: OmniProviderId;
  model: string;
  modelPro: string;
  ollamaBaseUrl: string;
  botName: string;
  language: string;
}

export interface ModelPreset {
  provider: OmniProviderId;
  id: string;
  label: string;
  note: string;
}

export const KEY_OPENROUTER = 'OPENROUTER_API_KEY';

export const MODEL_PRESETS: ModelPreset[] = [
  { provider: 'openrouter', id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B - darmowy', note: 'Bardzo mocny, darmowy w OpenRouter' },
  { provider: 'openrouter', id: 'deepseek/deepseek-chat-v3.1:free', label: 'DeepSeek V3.1 - darmowy', note: 'Swietny do rozmowy i kodu' },
  { provider: 'openrouter', id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B - darmowy', note: 'Uniwersalny, darmowy' },
  { provider: 'openrouter', id: 'qwen/qwen-2.5-coder-32b-instruct:free', label: 'Qwen 2.5 Coder 32B - darmowy', note: 'Do kodu' },
  { provider: 'ollama', id: 'qwen2.5:1.5b', label: 'Qwen 2.5 1.5B - lokalny', note: 'Lekki, dziala offline' },
  { provider: 'ollama', id: 'qwen2.5:7b', label: 'Qwen 2.5 7B - lokalny', note: 'Lepszy, wymaga ok. 5 GB RAM' },
];

const DEFAULTS: OmniConfig = {
  provider: 'ollama',
  model: 'qwen2.5:1.5b',
  modelPro: 'qwen2.5:1.5b',
  ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
  botName: 'Omni',
  language: 'pl',
};

export class ConfigStore {
  private readonly dir: string;
  private readonly file: string;
  public readonly secrets: SecretManager;
  private config: OmniConfig;
  private clock: number = 0;

  constructor(baseDir?: string) {
    this.dir = baseDir || path.join(os.homedir(), '.omni');
    this.file = path.join(this.dir, 'config.json');
    this.secrets = new SecretManager(path.join(this.dir, 'secrets'));
    this.config = Object.assign({}, DEFAULTS);
  }

  public async initialize(): Promise<void> {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<OmniConfig>;
        this.config = Object.assign({}, DEFAULTS, raw);
      }
    } catch (error) {
      this.config = Object.assign({}, DEFAULTS);
    }
    await this.secrets.initialize();
    this.applyToEnv();
  }

  public applyToEnv(): void {
    process.env.OMNI_LLM_PROVIDER = this.config.provider;
    process.env.OMNI_LLM_MODEL = this.config.model;
    process.env.OMNI_LLM_MODEL_PRO = this.config.modelPro;
    process.env.OLLAMA_BASE_URL = this.config.ollamaBaseUrl;
    const key = this.secrets.getSecret(KEY_OPENROUTER);
    if (key && key.length > 8) {
      process.env.OPENROUTER_API_KEY = key;
    }
  }

  public get(): OmniConfig {
    return Object.assign({}, this.config);
  }

  public hasOpenRouterKey(): boolean {
    const key = this.secrets.getSecret(KEY_OPENROUTER);
    return !!key && key.length > 8;
  }

  public keyNames(): string[] {
    try { return this.secrets.listSecrets(); } catch (error) { return []; }
  }

  public snapshot(): OmniConfig {
    return this.get();
  }

  public async save(patch: any, apiKeys?: Record<string, string>): Promise<OmniConfig> {
    const next: OmniConfig = Object.assign({}, this.config);
    if (patch.provider === 'ollama' || patch.provider === 'openrouter') next.provider = patch.provider;
    if (typeof patch.model === 'string' && patch.model.trim()) next.model = patch.model.trim();
    if (typeof patch.modelPro === 'string' && patch.modelPro.trim()) next.modelPro = patch.modelPro.trim();
    if (typeof patch.ollamaBaseUrl === 'string' && patch.ollamaBaseUrl.trim()) next.ollamaBaseUrl = patch.ollamaBaseUrl.trim();
    if (typeof patch.botName === 'string' && patch.botName.trim()) next.botName = patch.botName.trim();
    if (typeof patch.language === 'string' && patch.language.trim()) next.language = patch.language.trim();
    if (next.provider === 'openrouter' && next.model.indexOf(':free') === -1 && next.model.indexOf('/') === -1) {
      next.model = 'qwen/qwen-2.5-72b-instruct:free';
    }
    this.config = next;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      throw new Error('Nie udalo sie zapisac konfiguracji: ' + String(error));
    }
    const incoming = apiKeys || {};
    for (const name of Object.keys(incoming)) {
      const value = String(incoming[name] || '').trim();
      if (value.length < 8) continue;
      if (value.indexOf('...') !== -1) continue;
      await this.secrets.setSecret(name, value);
    }
    this.applyToEnv();
    this.clock = Date.now();
    return this.get();
  }

  public async removeKey(name: string): Promise<void> {
    await this.secrets.deleteSecret(name);
    if (name === KEY_OPENROUTER) delete process.env.OPENROUTER_API_KEY;
  }

  public lastSavedAt(): number { return this.clock; }
}

export function defaultConfig(): OmniConfig { return Object.assign({}, DEFAULTS); }
