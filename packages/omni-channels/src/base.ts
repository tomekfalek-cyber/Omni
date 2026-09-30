import { EventEmitter } from 'events';

export interface ChannelMessage {
  channelId: string;      // ID kanału (np. chat_id w Telegramie, channel_id w Slacku)
  threadId?: string;      // ID wątku (opcjonalne)
  userId: string;         // ID nadawcy
  text: string;           // Treść wiadomości
  attachments?: {         // Załączniki (pliki, obrazy)
    type: 'image' | 'file' | 'audio' | 'video';
    url: string;
    name?: string;
  }[];
  isGroup: boolean;       // Czy to wiadomość grupowa
  timestamp: number;
}

export interface ChannelEvent {
  type: 'message_received' | 'approval_required' | 'stream_token' | 'stream_done' | 'error';
  channelId: string;
  payload: any;
}

export interface StreamUpdate {
  messageId: string;      // ID wiadomości do edycji (np. dla Telegrama)
  fullText: string;       // Pełna, dotychczasowa treść
  isFinished: boolean;
}

/**
 * Abstrakcyjna klasa bazowa dla wszystkich adapterów kanałów.
 * Każdy adapter musi emitować zdarzenie 'message' po otrzymaniu wiadomości od użytkownika.
 */
export abstract class ChannelAdapter extends EventEmitter {
  public readonly name: string;
  protected allowedUsers: Set<string>;

  constructor(name: string, allowedUsers: string[] = []) {
    super();
    this.name = name;
    this.allowedUsers = new Set(allowedUsers);
  }

  /**
   * Sprawdza, czy użytkownik jest na whitelistie.
   */
  protected isUserAllowed(userId: string): boolean {
    if (this.allowedUsers.size === 0) return true; // Brak whitelisty = wszyscy dozwoleni
    return this.allowedUsers.has(userId);
  }

  /**
   * Wysyła nową wiadomość do kanału.
   */
  abstract sendMessage(channelId: string, text: string, threadId?: string): Promise<string>;

  /**
   * Edytuje istniejącą wiadomość (używane do streamingu tokenów).
   */
  abstract editMessage(channelId: string, messageId: string, newText: string): Promise<void>;

  /**
   * Wysyła wiadomość z przyciskami do zatwierdzenia akcji (Approval Workflow).
   */
  abstract sendApprovalRequest(
    channelId: string, 
    toolName: string, 
    args: Record<string, any>, 
    callId: string
  ): Promise<string>;

  /**
   * Startuje nasłuchiwanie na wiadomości przychodzące.
   */
  abstract start(): Promise<void>;

  /**
   * Zatrzymuje nasłuchiwanie i zwalnia zasoby.
   */
  abstract stop(): Promise<void>;
}
