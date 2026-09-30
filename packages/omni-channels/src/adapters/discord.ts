import { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ChannelAdapter, ChannelMessage } from '../base.js';

export class DiscordAdapter extends ChannelAdapter {
  private client: Client;
  private token: string;
  private applicationId: string;

  constructor(token: string, applicationId: string, allowedUsers: string[] = []) {
    super('discord', allowedUsers);
    this.token = token;
    this.applicationId = applicationId;
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ]
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.client.on(Events.ClientReady, () => {
      console.log(`[Discord] Zalogowano jako ${this.client.user?.tag}`);
      this.registerSlashCommands();
    });

    // Obsługa tradycyjnych wiadomości (np. w DM lub gdy bot jest wspomniany)
    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      
      // W grupach reaguj tylko na @wspomnienia
      if (message.guild && !message.mentions.has(this.client.user!)) return;

      const userId = message.author.id;
      if (!this.isUserAllowed(userId)) return;

      const cleanText = message.content.replace(/<@!?(\d+)>/, '').trim();
      if (!cleanText) return;

      const channelMessage: ChannelMessage = {
        channelId: message.channel.id,
        threadId: message.id, // Używamy ID wiadomości jako threadId dla odpowiedzi
        userId,
        text: cleanText,
        isGroup: !!message.guild,
        timestamp: Date.now(),
      };

      this.emit('message', channelMessage);
    });

    // Obsługa Slash Commands
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'omni') {
          const prompt = interaction.options.getString('prompt', true);
          const userId = interaction.user.id;
          
          if (!this.isUserAllowed(userId)) {
            await interaction.reply({ content: '⛔ Brak autoryzacji.', flags: MessageFlags.Ephemeral });
            return;
          }

          await interaction.deferReply();

          const channelMessage: ChannelMessage = {
            channelId: interaction.channelId,
            threadId: interaction.id,
            userId,
            text: prompt,
            isGroup: !!interaction.guild,
            timestamp: Date.now(),
          };

          // Zwracamy ID wiadomości, aby można było ją edytować (streaming)
          const reply = await interaction.fetchReply();
          (channelMessage as any).replyInteractionId = reply.id;

          this.emit('message', channelMessage);
        }
      } 
      // Obsługa przycisków Approval
      else if (interaction.isButton()) {
        const [action, callId, approved] = interaction.customId.split('|');
        if (action === 'approval') {
          this.emit('approval_response', {
            callId,
            approved: approved === 'true',
            channelId: interaction.channelId
          });

          await interaction.update({
            content: approved === 'true' ? '✅ Zatwierdzono.' : '❌ Odrzucono.',
            components: [] // Usuń przyciski
          });
        }
      }
    });
  }

  private async registerSlashCommands() {
    const rest = new REST({ version: '10' }).setToken(this.token);
    const commands = [
      new SlashCommandBuilder()
        .setName('omni')
        .setDescription('Wyślij polecenie do agenta Omni')
        .addStringOption(option => 
          option.setName('prompt').setDescription('Treść polecenia').setRequired(true)
        )
    ];

    try {
      await rest.put(Routes.applicationCommands(this.applicationId), { body: commands });
      console.log('[Discord] Slash commands zarejestrowane.');
    } catch (error) {
      console.error('[Discord] Błąd rejestracji slash commands:', error);
    }
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  async sendMessage(channelId: string, text: string, threadId?: string): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error('Kanał nie obsługuje tekstu');

    // Jeśli to odpowiedź na slash command, użyj editReply
    if ((channel as any).isCommand && threadId) {
       // W pełnej implementacji: trzymamy mapowanie interactionId -> channel
    }

    const msg = await (channel as any).send({
      content: text.substring(0, 2000), // Discord limit
      reply: threadId ? { messageReference: threadId } : undefined
    });
    
    return msg.id;
  }

  async editMessage(channelId: string, messageId: string, newText: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    try {
      const msg = await (channel as any).messages.fetch(messageId);
      await msg.edit(newText.substring(0, 2000));
    } catch (error) {
      // Ignoruj błędy
    }
  }

  async sendApprovalRequest(channelId: string, toolName: string, args: Record<string, any>, callId: string): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) throw new Error('Kanał nie obsługuje tekstu');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`approval|${callId}|true`)
        .setLabel('Zatwierdź')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`approval|${callId}|false`)
        .setLabel('Odrzuć')
        .setStyle(ButtonStyle.Danger)
    );

    const msg = await (channel as any).send({
      content: `⚠️ **Zatwierdzenie wymagane**\nNarzędzie: \`${toolName}\`\n\`\`\`json\n${JSON.stringify(args, null, 2).substring(0, 1800)}\n\`\`\``,
      components: [row]
    });

    return msg.id;
  }
}
