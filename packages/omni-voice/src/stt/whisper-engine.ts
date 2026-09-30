import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface STTOptions {
  engine: 'whisper-cpp' | 'openai-whisper';
  modelPath?: string;
  language?: string;
  apiKey?: string;
}

export interface TranscriptionResult {
  text: string;
  duration: number;
  language: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export class WhisperEngine extends EventEmitter {
  private options: STTOptions;
  private readonly WHISPER_CPP_PATH = process.env.WHISPER_CPP_PATH || './whisper.cpp/main';

  constructor(options: STTOptions) {
    super();
    this.options = {
      engine: options.engine || 'whisper-cpp',
      modelPath: options.modelPath || './models/ggml-base.bin',
      language: options.language || 'pl',
      apiKey: options.apiKey || process.env.OPENAI_API_KEY
    };
  }

  /**
   * Transkrybuje plik audio do tekstu.
   * @param audioPath Ścieżka do pliku audio (WAV, MP3, M4A)
   * @returns Obiekt z transkrypcją
   */
  public async transcribe(audioPath: string): Promise<TranscriptionResult> {
    if (this.options.engine === 'whisper-cpp') {
      return await this.transcribeWithWhisperCpp(audioPath);
    } else if (this.options.engine === 'openai-whisper') {
      return await this.transcribeWithOpenAI(audioPath);
    } else {
      throw new Error(`Nieobsługiwany silnik STT: ${this.options.engine}`);
    }
  }

  /**
   * Transkrypcja z użyciem whisper.cpp (lokalnie, bez internetu).
   */
  private async transcribeWithWhisperCpp(audioPath: string): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.options.modelPath!,
        '-f', audioPath,
        '-l', this.options.language!,
        '-otxt', // Output format: text
        '--print-special', // Drukuj znaki specjalne
        '--no-timestamps' // Bez znaczników czasu w wyjściu
      ];

      console.log(`[WhisperEngine] Uruchamiam whisper.cpp: ${this.WHISPER_CPP_PATH} ${args.join(' ')}`);

      const process = spawn(this.WHISPER_CPP_PATH, args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`whisper.cpp zakończył się z kodem ${code}\nstderr: ${stderr}`));
          return;
        }

        // Parsowanie wyjścia whisper.cpp
        const text = stdout.trim();
        const duration = this.estimateAudioDuration(audioPath);

        resolve({
          text,
          duration,
          language: this.options.language!,
          segments: [] // whisper.cpp w tym trybie nie zwraca segmentów
        });
      });

      process.on('error', (err) => {
        reject(new Error(`Błąd uruchomienia whisper.cpp: ${err.message}`));
      });
    });
  }

  /**
   * Transkrypcja z użyciem OpenAI Whisper API (wymaga klucza API).
   */
  private async transcribeWithOpenAI(audioPath: string): Promise<TranscriptionResult> {
    if (!this.options.apiKey) {
      throw new Error('Brak klucza API OpenAI dla silnika openai-whisper');
    }

    const FormData = (await import('form-data')).default;
    const axios = (await import('axios')).default;

    const formData = new FormData();
    formData.append('file', await fs.readFile(audioPath), {
      filename: path.basename(audioPath),
      contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', this.options.language);
    formData.append('response_format', 'verbose_json');

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${this.options.apiKey}`
          },
          timeout: 60000
        }
      );

      const data = response.data;
      return {
        text: data.text,
        duration: data.duration || 0,
        language: data.language || this.options.language!,
        segments: data.segments || []
      };
    } catch (error: any) {
      throw new Error(`Błąd OpenAI Whisper API: ${error.message}`);
    }
  }

  /**
   * Szacuje długość pliku audio na podstawie rozmiaru pliku.
   * (Dokładniejsze obliczenia wymagałyby parsowania nagłówków WAV)
   */
  private estimateAudioDuration(audioPath: string): number {
    try {
      const stats = require('fs').statSync(audioPath);
      const sizeMB = stats.size / (1024 * 1024);
      // Przybliżenie: 1 MB ≈ 1 minuta dla WAV 16kHz mono
      return sizeMB * 60;
    } catch {
      return 0;
    }
  }

  /**
   * Konwertuje plik audio do formatu wymaganego przez whisper.cpp (WAV 16kHz mono).
   */
  public async convertToWav(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = require('fluent-ffmpeg');
      
      ffmpeg(inputPath)
        .audioFrequency(16000)
        .audioChannels(1)
        .audioCodec('pcm_s16le')
        .output(outputPath)
        .on('end', () => {
          console.log(`[WhisperEngine] Konwersja zakończona: ${outputPath}`);
          resolve();
        })
        .on('error', (err: Error) => {
          reject(new Error(`Błąd konwersji audio: ${err.message}`));
        })
        .run();
    });
  }
}
