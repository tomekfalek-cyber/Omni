import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SecretManager } from './security/secret-manager.js';

export type OmniProviderId = 'ollama' | 'openrouter' | 'gemini' | 'groq';

export interface OmniConfig {
  provider: OmniProviderId;
  model: string;
  modelPro: string;
  ollamaBaseUrl: string;
  botName: string;
  language: string;
  autoApproveTools: boolean;
  voice: string;
  voiceRate: string;
  voiceAutoRead: boolean;
  voiceHandsFree: boolean;
  workspaceDir: string;
  accessCode: string;
}

export interface ProviderInfo {
  id: OmniProviderId;
  label: string;
  keyEnv: string;
  baseUrl: string;
  free: boolean;
  signup: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openrouter', label: 'OpenRouter (darmowe modele)', keyEnv: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', free: true, signup: 'https://openrouter.ai/keys' },
  { id: 'gemini', label: 'Google AI Studio (Gemini, darmowy)', keyEnv: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', free: true, signup: 'https://aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq (darmowy i bardzo szybki)', keyEnv: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', free: true, signup: 'https://console.groq.com/keys' },
  { id: 'ollama', label: 'Lokalnie (Ollama, bez klucza)', keyEnv: '', baseUrl: 'http://127.0.0.1:11434/v1', free: true, signup: '' },
];

export const KEY_OPENROUTER = 'OPENROUTER_API_KEY';

export interface ModelPreset {
  provider: OmniProviderId;
  id: string;
  label: string;
  note: string;
}

export const MODEL_PRESETS: ModelPreset[] = [
  { provider: 'openrouter', id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B - darmowy', note: 'Bardzo mocny' },
  { provider: 'openrouter', id: 'deepseek/deepseek-chat-v3.1:free', label: 'DeepSeek V3.1 - darmowy', note: 'Rozmowa i kod' },
  { provider: 'openrouter', id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B - darmowy', note: 'Uniwersalny' },
  { provider: 'gemini', id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash - darmowy', note: 'Szybki, darmowy limit' },
  { provider: 'gemini', id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', note: 'Najszybszy' },
  { provider: 'groq', id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)', note: 'Najmocniejszy na Groq' },
  { provider: 'groq', id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)', note: 'Szybki i madry' },
  { provider: 'groq', id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (Groq)', note: 'Blyskawiczny' },
  { provider: 'ollama', id: 'qwen2.5:1.5b', label: 'Qwen 2.5 1.5B - lokalny', note: 'Offline, slabszy' },
  { provider: 'ollama', id: 'qwen2.5:7b', label: 'Qwen 2.5 7B - lokalny', note: 'Wymaga ok. 5 GB RAM' },
];

const DEFAULTS: OmniConfig = {
  provider: 'ollama',
  model: 'qwen2.5:1.5b',
  modelPro: 'qwen2.5:1.5b',
  ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
  botName: 'Omni',
  language: 'pl',
  autoApproveTools: true,
  voice: 'pl-PL-MarekNeural',
  voiceRate: '+0%',
  voiceAutoRead: false,
  voiceHandsFree: false,
  workspaceDir: '/home/openclaw',
  accessCode: '',
};

export function providerInfo(id: string): ProviderInfo {
  for (const p of PROVIDERS) { if (p.id === id) return p; }
  return PROVIDERS[PROVIDERS.length - 1];
}

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
    const info = providerInfo(this.config.provider);
    process.env.OMNI_LLM_PROVIDER = this.config.provider;
    process.env.OMNI_LLM_MODEL = this.config.model;
    process.env.OMNI_LLM_MODEL_PRO = this.config.modelPro;
    process.env.OLLAMA_BASE_URL = this.config.ollamaBaseUrl;
    process.env.OMNI_LLM_BASE_URL = info.baseUrl;
    for (const p of PROVIDERS) {
      if (!p.keyEnv) continue;
      const value = this.secrets.getSecret(p.keyEnv);
      if (value && value.length > 8) {
        process.env[p.keyEnv] = value;
      }
    }
    const activeKey = info.keyEnv ? this.secrets.getSecret(info.keyEnv) : '';
    process.env.OMNI_LLM_API_KEY = (activeKey && activeKey.length > 8) ? activeKey : 'ollama';
    const integrationKeys = ['GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WHATSAPP_TO'];
    for (const name of integrationKeys) {
      const val = this.secrets.getSecret(name);
      if (val) { process.env[name] = val; }
    }
  }

  public get(): OmniConfig {
    return Object.assign({}, this.config);
  }

  public hasKeyFor(id: string): boolean {
    const info = providerInfo(id);
    if (!info.keyEnv) return true;
    const key = this.secrets.getSecret(info.keyEnv);
    return !!key && key.length > 8;
  }

  public dataDir(): string { return this.dir; }

  public hasOpenRouterKey(): boolean {
    return this.hasKeyFor('openrouter');
  }

  public keyNames(): string[] {
    try { return this.secrets.listSecrets(); } catch (error) { return []; }
  }

  public async save(patch: any, apiKeys?: Record<string, string>): Promise<OmniConfig> {
    const next: OmniConfig = Object.assign({}, this.config);
    if (patch.provider && providerInfo(patch.provider).id === patch.provider) next.provider = patch.provider;
    if (typeof patch.model === 'string' && patch.model.trim()) next.model = patch.model.trim();
    if (typeof patch.modelPro === 'string' && patch.modelPro.trim()) next.modelPro = patch.modelPro.trim();
    if (typeof patch.ollamaBaseUrl === 'string' && patch.ollamaBaseUrl.trim()) next.ollamaBaseUrl = patch.ollamaBaseUrl.trim();
    if (typeof patch.botName === 'string' && patch.botName.trim()) next.botName = patch.botName.trim();
    if (typeof patch.language === 'string' && patch.language.trim()) next.language = patch.language.trim();
    if (typeof patch.autoApproveTools === 'boolean') next.autoApproveTools = patch.autoApproveTools;
    if (typeof patch.voice === 'string' && patch.voice.trim()) next.voice = patch.voice.trim();
    if (typeof patch.voiceRate === 'string' && patch.voiceRate.trim()) next.voiceRate = patch.voiceRate.trim();
    if (typeof patch.voiceAutoRead === 'boolean') next.voiceAutoRead = patch.voiceAutoRead;
    if (typeof patch.voiceHandsFree === 'boolean') next.voiceHandsFree = patch.voiceHandsFree;
    if (typeof patch.workspaceDir === 'string' && patch.workspaceDir.trim()) next.workspaceDir = patch.workspaceDir.trim();
    if (typeof patch.accessCode === 'string') next.accessCode = patch.accessCode.trim();

    const incoming = apiKeys || {};
    for (const name of Object.keys(incoming)) {
      const value = String(incoming[name] || '').trim();
      if (value.length < 8) continue;
      if (value.indexOf('...') !== -1) continue;
      await this.secrets.setSecret(name, value);
    }

    const providerChanged = next.provider !== this.config.provider;
    const chosen = providerInfo(next.provider);
    if (chosen.keyEnv && !this.hasKeyFor(next.provider)) {
      // brak klucza dla wybranego dostawcy - zostan lokalnie, zeby bot dalej dzialal
      next.provider = 'ollama';
      next.model = 'qwen2.5:1.5b';
      next.modelPro = 'qwen2.5:1.5b';
    }
    const allowed = MODEL_PRESETS.filter((m) => m.provider === next.provider).map((m) => m.id);
    const postedModel = typeof patch.model === 'string' ? patch.model.trim() : '';
    const belongsElsewhere = MODEL_PRESETS.some((m) => m.provider !== next.provider && m.id === postedModel);
    if (next.provider !== 'ollama' && allowed.length > 0 && (belongsElsewhere || !postedModel)) {
      next.model = allowed[0];
      next.modelPro = allowed[0];
    }

    this.config = next;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      throw new Error('Nie udalo sie zapisac konfiguracji: ' + String(error));
    }
    this.applyToEnv();
    this.clock = Date.now();
    return this.get();
  }

  public async removeKey(name: string): Promise<void> {
    await this.secrets.deleteSecret(name);
    delete process.env[name];
    this.applyToEnv();
  }

  public lastSavedAt(): number { return this.clock; }
}

export function defaultConfig(): OmniConfig { return Object.assign({}, DEFAULTS); }
