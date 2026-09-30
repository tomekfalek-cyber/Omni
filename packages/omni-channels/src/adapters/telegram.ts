import TelegramBot from 'node-telegram-bot-api';
import { ChannelAdapter, ChannelMessage, StreamUpdate } from '../base.js';

export class TelegramAdapter extends ChannelAdapter {
  private bot: TelegramBot;
  private streamBuffers: Map<string, { text: string; lastUpdate: number; messageId: number }> = new Map();
  private readonly STREAM_DEBOUNCE_MS = 1500; // Telegram limit: 30 edits/min. Buforujemy co 1.5s.
  private readonly MAX_MESSAGE_LENGTH = 4000; // Telegram limit to 4096, zostawiamy margines.

  constructor(token: string, allowedUsers: string[] = []) {
    super('telegram', allowedUsers);
    this.bot = new TelegramBot(token, { polling: true });
    this.setupListeners();
  }

  private setupListeners() {
    this.bot.on('message', async (msg) => {
      if (!msg.text || !msg.chat || !msg.from) return;
      
      const userId = msg.from.id.toString();
      if (!this.isUserAllowed(userId)) {
        await this.bot.sendMessage(msg.chat.id, '⛔ Brak autoryzacji do korzystania z tego bota.');
        return;
      }

      const channelMessage: ChannelMessage = {
        channelId: msg.chat.id.toString(),
        threadId: msg.message_thread_id?.toString(),
        userId,
        text: msg.text,
        isGroup: msg.chat.type !== 'private',
        timestamp: Date.now(),
      };

      this.emit('message', channelMessage);
    });

    // Obsługa kliknięć w przyciski Approval
    this.bot.on('callback_query', async (query) => {
      if (!query.data || !query.message) return;
      
      const [action, callId, approved] = query.data.split('|');
      if (action === 'approval') {
        this.emit('approval_response', {
          callId,
          approved: approved === 'true',
          channelId: query.message.chat.id.toString()
        });
        
        await this.bot.answerCallbackQuery(query.id, { 
          text: approved === 'true' ? '✅ Zatwierdzono' : '❌ Odrzucono' 
        });
        
        // Edytuj wiadomość, aby usunąć przyciski
        await this.bot.editMessageReplyMarkup(null, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id
        });
      }
    });
  }

  async start(): Promise<void> {
    console.log('[Telegram] Adapter uruchomiony i nasłuchuje wiadomości.');
  }

  async stop(): Promise<void> {
    this.bot.stopPolling();
  }

  async sendMessage(channelId: string, text: string, threadId?: string): Promise<string> {
    const chunks = this.splitMessage(text);
    let lastMsgId = 0;
    
    for (const chunk of chunks) {
      const msg = await this.bot.sendMessage(Number(channelId), chunk, {
        parse_mode: 'Markdown',
        reply_to_message_id: threadId ? Number(threadId) : undefined
      });
      lastMsgId = msg.message_id;
    }
    
    return lastMsgId.toString();
  }

  async editMessage(channelId: string, messageId: string, newText: string): Promise<void> {
    try {
      await this.bot.editMessageText(newText, {
        chat_id: Number(channelId),
        message_id: Number(messageId),
        parse_mode: 'Markdown'
      });
    } catch (error: any) {
      // Ignoruj błędy "message is not modified"
      if (!error.message.includes('message is not modified')) {
        console.error('[Telegram] Błąd edycji wiadomości:', error.message);
      }
    }
  }

  async sendApprovalRequest(channelId: string, toolName: string, args: Record<string, any>, callId: string): Promise<string> {
    const text = `⚠️ *Zatwierdzenie wymagane*\n\nNarzędzie: \`${toolName}\`\nArgumenty:\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
    
    const msg = await this.bot.sendMessage(Number(channelId), text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Zatwierdź', callback_data: `approval|${callId}|true` },
            { text: '❌ Odrzuć', callback_data: `approval|${callId}|false` }
          ]
        ]
      }
    });
    
    return msg.message_id.toString();
  }

  /**
   * Specyficzna metoda dla Telegrama do obsługi streamingu z debounce'm.
   */
  public async handleStreamUpdate(channelId: string, update: StreamUpdate): Promise<void> {
    const key = `${channelId}_${update.messageId}`;
    const buffer = this.streamBuffers.get(key) || { text: '', lastUpdate: 0, messageId: Number(update.messageId) };
    
    buffer.text = update.fullText;

    const now = Date.now();
    if (update.isFinished || (now - buffer.lastUpdate > this.STREAM_DEBOUNCE_MS)) {
      const safeText = buffer.text.substring(0, this.MAX_MESSAGE_LENGTH);
      await this.editMessage(channelId, buffer.messageId.toString(), safeText);
      buffer.lastUpdate = now;
      
      if (update.isFinished) {
        this.streamBuffers.delete(key);
      } else {
        this.streamBuffers.set(key, buffer);
      }
    } else {
      this.streamBuffers.set(key, buffer);
    }
  }

  private splitMessage(text: string): string[] {
    if (text.length <= this.MAX_MESSAGE_LENGTH) return [text];
    const chunks = [];
    for (let i = 0; i < text.length; i += this.MAX_MESSAGE_LENGTH) {
      chunks.push(text.substring(i, i + this.MAX_MESSAGE_LENGTH));
    }
    return chunks;
  }
}
