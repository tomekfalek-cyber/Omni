import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import FormData from 'form-data';

export interface TTSOptions {
  engine: 'xtts' | 'kokoro' | 'piper' | 'openai-tts';
  xttsUrl?: string;
  voiceSamplePath?: string;
  language?: string;
  apiKey?: string;
}

export interface SynthesisResult {
  audioPath: string;
  duration: number;
  format: string;
}

export class XTTSEngine {
  private options: TTSOptions;
  private readonly OUTPUT_DIR = '.omni/voice-output';

  constructor(options: TTSOptions) {
    this.options = {
      engine: options.engine || 'xtts',
      xttsUrl: options.xttsUrl || process.env.OMNI_VOICE_XTTS_URL || 'http://localhost:8020/tts_to_audio',
      voiceSamplePath: options.voiceSamplePath || process.env.OMNI_VOICE_XTTS_SAMPLE,
      language: options.language || 'pl',
      apiKey: options.apiKey || process.env.OPENAI_API_KEY
    };

    // Upewnij się, że katalog wyjściowy istnieje
    fs.mkdir(this.OUTPUT_DIR, { recursive: true }).catch(() => {});
  }

  /**
   * Syntezuje mowę z tekstu.
   * @param text Tekst do wypowiedzenia
   * @param outputPath Ścieżka do pliku wyjściowego (opcjonalna)
   * @returns Obiekt z informacjami o wygenerowanym audio
   */
  public async synthesize(text: string, outputPath?: string): Promise<SynthesisResult> {
    if (this.options.engine === 'xtts') {
      return await this.synthesizeWithXTTS(text, outputPath);
    } else if (this.options.engine === 'openai-tts') {
      return await this.synthesizeWithOpenAI(text, outputPath);
    } else {
      throw new Error(`Nieobsługiwany silnik TTS: ${this.options.engine}`);
    }
  }

  /**
   * Synteza z użyciem XTTS v2 (lokalny serwer z klonowaniem głosu).
   */
  private async synthesizeWithXTTS(text: string, outputPath?: string): Promise<SynthesisResult> {
    if (!this.options.voiceSamplePath) {
      throw new Error('Brak próbki głosu dla XTTS. Ustaw OMNI_VOICE_XTTS_SAMPLE.');
    }

    // Sprawdź, czy próbka głosu istnieje
    try {
      await fs.access(this.options.voiceSamplePath);
    } catch {
      throw new Error(`Próbka głosu nie znaleziona: ${this.options.voiceSamplePath}`);
    }

    const finalOutputPath = outputPath || path.join(
      this.OUTPUT_DIR,
      `tts_${Date.now()}.wav`
    );

    try {
      console.log(`[XTTSEngine] Wysyłam żądanie do XTTS: ${text.substring(0, 50)}...`);

      // Przygotowanie multipart/form-data
      const formData = new FormData();
      formData.append('text', text);
      formData.append('language', this.options.language!);
      
      // Dodanie próbki głosu do klonowania
      const voiceSample = await fs.readFile(this.options.voiceSamplePath);
      formData.append('speaker_wav', voiceSample, {
        filename: path.basename(this.options.voiceSamplePath),
        contentType: 'audio/wav'
      });

      // Żądanie do XTTS API
      const response = await axios.post(
        this.options.xttsUrl!,
        formData,
        {
          headers: {
            ...formData.getHeaders()
          },
          responseType: 'arraybuffer',
          timeout: 120000 // 2 minuty timeout (XTTS może być wolne)
        }
      );

      // Zapisanie wygenerowanego audio
      await fs.writeFile(finalOutputPath, Buffer.from(response.data));

      // Szacowanie długości audio
      const stats = await fs.stat(finalOutputPath);
      const duration = this.estimateWavDuration(stats.size);

      console.log(`[XTTSEngine] Audio wygenerowane: ${finalOutputPath} (${duration.toFixed(2)}s)`);

      return {
        audioPath: finalOutputPath,
        duration,
        format: 'wav'
      };
    } catch (error: any) {
      throw new Error(`Błąd XTTS API: ${error.message}`);
    }
  }

  /**
   * Synteza z użyciem OpenAI TTS API (wymaga klucza API).
   */
  private async synthesizeWithOpenAI(text: string, outputPath?: string): Promise<SynthesisResult> {
    if (!this.options.apiKey) {
      throw new Error('Brak klucza API OpenAI dla silnika openai-tts');
    }

    const finalOutputPath = outputPath || path.join(
      this.OUTPUT_DIR,
      `tts_${Date.now()}.mp3`
    );

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1',
          input: text,
          voice: 'alloy', // Dostępne: alloy, echo, fable, onyx, nova, shimmer
          response_format: 'mp3'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: 60000
        }
      );

      await fs.writeFile(finalOutputPath, Buffer.from(response.data));

      const stats = await fs.stat(finalOutputPath);
      const duration = this.estimateMp3Duration(stats.size);

      return {
        audioPath: finalOutputPath,
        duration,
        format: 'mp3'
      };
    } catch (error: any) {
      throw new Error(`Błąd OpenAI TTS API: ${error.message}`);
    }
  }

  /**
   * Szacuje długość pliku WAV na podstawie rozmiaru.
   * Zakłada: 16kHz, mono, 16-bit PCM = 32000 bajtów/s
   */
  private estimateWavDuration(sizeBytes: number): number {
    const bytesPerSecond = 32000; // 16000 Hz * 1 channel * 2 bytes
    return sizeBytes / bytesPerSecond;
  }

  /**
   * Szacuje długość pliku MP3 na podstawie rozmiaru.
   * Zakłada: bitrate 128 kbps = 16000 bajtów/s
   */
  private estimateMp3Duration(sizeBytes: number): number {
    const bytesPerSecond = 16000; // 128 kbps / 8
    return sizeBytes / bytesPerSecond;
  }

  /**
   * Klonuje głos z próbki audio i zapisuje go jako preset.
   * (XTTS v2 wymaga 6-30 sekund czystej próbki)
   */
  public async cloneVoice(samplePath: string, presetName: string): Promise<string> {
    const presetDir = path.join(this.OUTPUT_DIR, 'voice-presets');
    await fs.mkdir(presetDir, { recursive: true });

    const presetPath = path.join(presetDir, `${presetName}.wav`);
    
    // Kopiowanie próbki jako preset
    await fs.copyFile(samplePath, presetPath);
    
    console.log(`[XTTSEngine] Preset głosu zapisany: ${presetPath}`);
    return presetPath;
  }

  /**
   * Lista dostępnych presetów głosów.
   */
  public async listVoicePresets(): Promise<string[]> {
    const presetDir = path.join(this.OUTPUT_DIR, 'voice-presets');
    
    try {
      const files = await fs.readdir(presetDir);
      return files.filter(f => f.endsWith('.wav')).map(f => f.replace('.wav', ''));
    } catch {
      return [];
    }
  }
}
