import { ChannelAdapter, ChannelMessage } from './base.js';
import { SwarmManager } from 'omni-swarm/swarm-manager.js';
import { ApprovalManager } from 'omni-core/approval-manager.js';

export class ChannelManager {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private swarm: SwarmManager;
  private approvalManager: ApprovalManager;

  constructor(swarm: SwarmManager, approvalManager: ApprovalManager) {
    this.swarm = swarm;
    this.approvalManager = approvalManager;
  }

  public registerAdapter(adapter: ChannelAdapter) {
    this.adapters.set(adapter.name, adapter);

    // Nasłuchiwanie na wiadomości od użytkowników
    adapter.on('message', async (msg: ChannelMessage) => {
      await this.handleIncomingMessage(adapter.name, msg);
    });

    // Nasłuchiwanie na odpowiedzi approval z kanałów zewnętrznych
    adapter.on('approval_response', (data: { callId: string, approved: boolean, channelId: string }) => {
      this.approvalManager.respondToApproval(data.callId, data.approved);
    });

    console.log(`[ChannelManager] Zarejestrowano adapter: ${adapter.name}`);
  }

  public async startAll() {
    for (const adapter of this.adapters.values()) {
      await adapter.start();
    }
  }

  public async stopAll() {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
  }

  private async handleIncomingMessage(adapterName: string, msg: ChannelMessage) {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) return;

    const sessionId = `${adapterName}_${msg.channelId}_${msg.threadId || 'main'}`;
    
    // Wyślij informację o rozpoczęciu myślenia
    const thinkingMsgId = await adapter.sendMessage(msg.channelId, '🔄 Omni myśli...', msg.threadId);

    try {
      // Uruchom zadanie w SwarmManager
      const task = await this.swarm.executeTask(sessionId, msg.text, process.cwd());
      
      // Edytuj wiadomość z wynikiem
      if (task.status === 'completed') {
        await adapter.editMessage(msg.channelId, thinkingMsgId, `✅ ${task.result}`);
      } else {
        await adapter.editMessage(msg.channelId, thinkingMsgId, `❌ Błąd: ${task.error}`);
      }
    } catch (error: any) {
      await adapter.editMessage(msg.channelId, thinkingMsgId, `❌ Krytyczny błąd: ${error.message}`);
    }
  }

  /**
   * Metoda wywoływana przez ApprovalManager, gdy potrzebne jest zatwierdzenie.
   * Znajduje odpowiedni adapter na podstawie channelId i wysyła prośbę.
   */
  public async requestApprovalFromChannel(channelId: string, toolName: string, args: Record<string, any>, callId: string) {
    // W pełnej implementacji: trzymamy mapowanie channelId -> adapterName
    // Na potrzeby tego kodu: iterujemy po wszystkich adapterach (lub używamy prefiksa channelId)
    for (const adapter of this.adapters.values()) {
      if (channelId.startsWith(adapter.name) || true) { // Uproszczenie
        try {
          await adapter.sendApprovalRequest(channelId, toolName, args, callId);
          return;
        } catch (e) {
          // Kontynuuj do następnego adaptera
        }
      }
    }
    console.warn(`[ChannelManager] Nie znaleziono aktywnego kanału dla channelId: ${channelId}`);
  }
}
