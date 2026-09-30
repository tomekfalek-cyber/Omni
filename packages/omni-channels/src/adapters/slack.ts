import { App, LogLevel } from '@slack/bolt';
import { ChannelAdapter, ChannelMessage } from '../base.js';

export class SlackAdapter extends ChannelAdapter {
  private app: App;

  constructor(
    botToken: string, 
    appToken: string, 
    signingSecret: string, 
    allowedUsers: string[] = []
  ) {
    super('slack', allowedUsers);
    
    this.app = new App({
      token: botToken,
      appToken: appToken,
      signingSecret: signingSecret,
      logLevel: LogLevel.INFO,
      socketMode: true, // Używamy Socket Mode, aby nie wymagać publicznego URL
    });

    this.setupListeners();
  }

  private setupListeners() {
    // Nasłuchiwanie na wiadomości
    this.app.event('message', async ({ event, client }) => {
      if (!('text' in event) || !event.text || !event.user || !event.channel) return;
      if (event.subtype && event.subtype !== 'file_share') return; // Ignoruj edycje, bot messages itp.

      const userId = event.user;
      if (!this.isUserAllowed(userId)) return;

      const channelMessage: ChannelMessage = {
        channelId: event.channel,
        threadId: 'thread_ts' in event ? event.thread_ts : event.ts,
        userId,
        text: event.text,
        isGroup: event.channel.startsWith('C'), // C = public channel, G = private, D = DM
        timestamp: Date.now(),
      };

      this.emit('message', channelMessage);
    });

    // Obsługa akcji (przyciski Approval)
    this.app.action('approve_action', async ({ ack, body, client }) => {
      await ack();
      const callId = (body as any).actions[0].value;
      
      this.emit('approval_response', {
        callId,
        approved: true,
        channelId: (body as any).channel.id
      });

      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: '✅ Zatwierdzono przez użytkownika.',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '✅ *Zatwierdzono*' } }]
      });
    });

    this.app.action('reject_action', async ({ ack, body, client }) => {
      await ack();
      const callId = (body as any).actions[0].value;
      
      this.emit('approval_response', {
        callId,
        approved: false,
        channelId: (body as any).channel.id
      });

      await client.chat.update({
        channel: (body as any).channel.id,
        ts: (body as any).message.ts,
        text: '❌ Odrzucono przez użytkownika.',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '❌ *Odrzucono*' } }]
      });
    });
  }

  async start(): Promise<void> {
    await this.app.start();
    console.log('[Slack] Adapter uruchomiony w trybie Socket Mode.');
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async sendMessage(channelId: string, text: string, threadId?: string): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadId,
      unfurl_links: false
    });
    return result.ts || '';
  }

  async editMessage(channelId: string, messageId: string, newText: string): Promise<void> {
    await this.app.client.chat.update({
      channel: channelId,
      ts: messageId,
      text: newText
    });
  }

  async sendApprovalRequest(channelId: string, toolName: string, args: Record<string, any>, callId: string): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel: channelId,
      text: `⚠️ Wymagane zatwierdzenie dla narzędzia: ${toolName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *Zatwierdzenie wymagane*\n*Narzędzie:* \`${toolName}\`\n*Argumenty:*\n\`\`\`${JSON.stringify(args, null, 2)}\`\`\``
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Zatwierdź' },
              style: 'primary',
              action_id: 'approve_action',
              value: callId
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Odrzuć' },
              style: 'danger',
              action_id: 'reject_action',
              value: callId
            }
          ]
        }
      ]
    });
    return result.ts || '';
  }
}
