import { WhisperEngine, STTOptions, TranscriptionResult } from './stt/whisper-engine.js';
import { XTTSEngine, TTSOptions, SynthesisResult } from './tts/xtts-engine.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface VoiceConfig {
  stt: STTOptions;
  tts: TTSOptions;
  autoPlayAudio?: boolean;
}

export class VoiceManager {
  private sttEngine: WhisperEngine;
  private ttsEngine: XTTSEngine;
  private config: VoiceConfig;

  constructor(config: VoiceConfig) {
    this.config = config;
    this.sttEngine = new WhisperEngine(config.stt);
    this.ttsEngine = new XTTSEngine(config.tts);
  }

  /**
   * Transkrybuje nagranie audio do tekstu (STT).
   */
  public async speechToText(audioPath: string): Promise<string> {
    console.log(`[VoiceManager] Rozpoczynam transkrypcję: ${audioPath}`);
    
    // Konwersja do WAV 16kHz mono jeśli to konieczne
    const ext = path.extname(audioPath).toLowerCase();
    let wavPath = audioPath;
    
    if (ext !== '.wav') {
      wavPath = audioPath.replace(ext, '_converted.wav');
      await this.sttEngine.convertToWav(audioPath, wavPath);
    }

    const result: TranscriptionResult = await this.sttEngine.transcribe(wavPath);
    
    // Sprzątanie tymczasowego pliku WAV
    if (wavPath !== audioPath) {
      await fs.unlink(wavPath).catch(() => {});
    }

    console.log(`[VoiceManager] Transkrypcja zakończona: ${result.text.substring(0, 50)}...`);
    return result.text;
  }

  /**
   * Syntezuje tekst do mowy (TTS).
   */
  public async textToSpeech(text: string, outputPath?: string): Promise<string> {
    console.log(`[VoiceManager] Rozpoczynam syntezę: ${text.substring(0, 50)}...`);
    
    const result: SynthesisResult = await this.ttsEngine.synthesize(text, outputPath);
    
    console.log(`[VoiceManager] Synteza zakończona: ${result.audioPath} (${result.duration.toFixed(2)}s)`);
    return result.audioPath;
  }

  /**
   * Pełny cykl głosowy: nasłuchuj → transkrybuj → odpowiedz → powiedz.
   */
  public async voiceLoop(userAudioPath: string, agentResponse: string): Promise<string> {
    // 1. Transkrypcja pytania użytkownika
    const userText = await this.speechToText(userAudioPath);
    console.log(`[VoiceManager] Użytkownik powiedział: "${userText}"`);

    // 2. Synteza odpowiedzi agenta
    const agentAudioPath = await this.textToSpeech(agentResponse);
    console.log(`[VoiceManager] Agent odpowiedział: "${agentResponse}"`);

    return agentAudioPath;
  }

  /**
   * Klonuje głos z próbki audio.
   */
  public async cloneVoice(samplePath: string, presetName: string): Promise<string> {
    return await this.ttsEngine.cloneVoice(samplePath, presetName);
  }

  /**
   * Lista dostępnych presetów głosów.
   */
  public async listVoicePresets(): Promise<string[]> {
    return await this.ttsEngine.listVoicePresets();
  }

  /**
   * Zmienia język STT/TTS.
   */
  public setLanguage(language: string): void {
    this.config.stt.language = language;
    this.config.tts.language = language;
    console.log(`[VoiceManager] Język ustawiony na: ${language}`);
  }
}
