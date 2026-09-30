import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

export interface VoiceInfo {
  id: string;
  label: string;
  gender: string;
  engine: string;
  available: boolean;
}

const EDGE_BIN = path.join(os.homedir(), '.omni', 'venv', 'bin', 'edge-tts');
const PIPER_BIN = path.join(os.homedir(), '.omni', 'venv', 'bin', 'piper');

const EDGE_VOICES: VoiceInfo[] = [
  { id: 'pl-PL-MarekNeural', label: 'Marek - polski, spokojny mezczyzna (standard)', gender: 'male', engine: 'edge', available: true },
  { id: 'pl-PL-ZofiaNeural', label: 'Zofia - polski, kobieta', gender: 'female', engine: 'edge', available: true },
  { id: 'en-US-GuyNeural', label: 'Guy - angielski, mezczyzna', gender: 'male', engine: 'edge', available: true },
  { id: 'en-US-AriaNeural', label: 'Aria - angielski, kobieta', gender: 'female', engine: 'edge', available: true },
  { id: 'de-DE-ConradNeural', label: 'Conrad - niemiecki, mezczyzna', gender: 'male', engine: 'edge', available: true },
];

export class VoiceManager {
  private readonly voicesDir: string;
  private readonly outDir: string;

  constructor(baseDir?: string) {
    const base = baseDir || path.join(os.homedir(), '.omni');
    this.voicesDir = path.join(base, 'voices');
    this.outDir = path.join(base, 'tts');
    try { fs.mkdirSync(this.voicesDir, { recursive: true }); fs.mkdirSync(this.outDir, { recursive: true }); } catch (error) { }
  }

  public edgeAvailable(): boolean {
    try { return fs.existsSync(EDGE_BIN); } catch (error) { return false; }
  }

  public piperAvailable(): boolean {
    try { return fs.existsSync(PIPER_BIN); } catch (error) { return false; }
  }

  /** Wgrane glosy Piper (pliki .onnx w katalogu glosow). */
  public uploadedVoices(): VoiceInfo[] {
    const out: VoiceInfo[] = [];
    try {
      const files = fs.readdirSync(this.voicesDir).filter((f) => f.endsWith('.onnx'));
      for (const file of files) {
        const name = file.slice(0, file.length - 5);
        out.push({ id: 'piper:' + name, label: name + ' - wgrany glos (Piper)', gender: 'unknown', engine: 'piper', available: this.piperAvailable() });
      }
    } catch (error) { }
    return out;
  }

  public listVoices(): VoiceInfo[] {
    const edge = EDGE_VOICES.map((v) => ({ ...v, available: this.edgeAvailable() }));
    return edge.concat(this.uploadedVoices());
  }

  public saveUploadedVoice(name: string, onnxBase64: string, configBase64?: string): string {
    const safe = String(name || '').replace(new RegExp('[^A-Za-z0-9_-]', 'g'), '_').slice(0, 60);
    if (!safe) { throw new Error('Podaj nazwe glosu.'); }
    if (!onnxBase64) { throw new Error('Brak pliku modelu (.onnx).'); }
    const modelPath = path.join(this.voicesDir, safe + '.onnx');
    fs.writeFileSync(modelPath, Buffer.from(onnxBase64, 'base64'));
    if (configBase64) {
      fs.writeFileSync(path.join(this.voicesDir, safe + '.onnx.json'), Buffer.from(configBase64, 'base64'));
    }
    return 'piper:' + safe;
  }

  private run(bin: string, args: string[], stdin?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = execFile(bin, args, { maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
        if (error) { reject(new Error(String(stderr || error.message).slice(0, 400))); return; }
        resolve(String(stdout || ''));
      });
      if (stdin && child.stdin) { child.stdin.write(stdin); child.stdin.end(); }
    });
  }

  /** Zamienia tekst na mowe. Zwraca sciezke pliku audio. */
  public async speak(text: string, voiceId: string, rate: string = '+0%'): Promise<{ file: string, mime: string }> {
    const clean = String(text || '').slice(0, 4000);
    if (!clean.trim()) { throw new Error('Brak tekstu.'); }
    const stamp = 'tts_' + Date.now() + '_' + Math.floor(Math.random() * 10000);

    if (String(voiceId).indexOf('piper:') === 0) {
      const name = String(voiceId).slice(6);
      const model = path.join(this.voicesDir, name + '.onnx');
      if (!fs.existsSync(model)) { throw new Error('Nie ma takiego wgranego glosu: ' + name); }
      if (!this.piperAvailable()) { throw new Error('Silnik Piper nie jest zainstalowany - wgrany glos nie moze czytac.'); }
      const outWav = path.join(this.outDir, stamp + '.wav');
      await this.run(PIPER_BIN, ['--model', model, '--output_file', outWav], clean);
      return { file: outWav, mime: 'audio/wav' };
    }

    if (!this.edgeAvailable()) { throw new Error('Silnik glosu (edge-tts) nie jest zainstalowany.'); }
    const outMp3 = path.join(this.outDir, stamp + '.mp3');
    await this.run(EDGE_BIN, ['--voice', String(voiceId || 'pl-PL-MarekNeural'), '--rate=' + rate, '--text', clean, '--write-media', outMp3]);
    return { file: outMp3, mime: 'audio/mpeg' };
  }

  public outDirPath(): string { return this.outDir; }
}
