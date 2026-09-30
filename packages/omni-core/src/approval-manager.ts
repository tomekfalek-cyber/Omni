import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { ToolCall, ToolApprovalStatus } from './types.js';

export class ApprovalManager extends EventEmitter {
  private pendingApprovals: Map<string, {
    toolCall: ToolCall;
    resolve: (approved: boolean) => void;
    timeoutId: NodeJS.Timeout;
  }> = new Map();

  private readonly DEFAULT_TIMEOUT_MS = 60000; // 60 sekund na zatwierdzenie

  constructor() {
    super();
  }

  public async requestApproval(
    toolName: string,
    args: Record<string, any>,
    timeoutMs: number = this.DEFAULT_TIMEOUT_MS
  ): Promise<boolean> {
    const callId = uuidv4();
    const toolCall: ToolCall = {
      id: callId,
      name: toolName,
      arguments: args,
      status: 'pending',
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.rejectApproval(callId, 'Timeout: Brak odpowiedzi użytkownika');
        reject(new Error('Przekroczono czas oczekiwania na zatwierdzenie'));
      }, timeoutMs);

      this.pendingApprovals.set(callId, { toolCall, resolve, timeoutId });
      
      // Emituj zdarzenie do Gateway, aby powiadomić klienta (CLI/Desktop/Mobile)
      this.emit('approval_required', {
        callId,
        toolName,
        args,
        timestamp: Date.now()
      });
    });
  }

  public respondToApproval(callId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(callId);
    if (!pending) {
      throw new Error(`Nie znaleziono oczekującego zatwierdzenia dla ID: ${callId}`);
    }

    clearTimeout(pending.timeoutId);
    pending.toolCall.status = approved ? 'approved' : 'rejected';
    pending.resolve(approved);
    this.pendingApprovals.delete(callId);
  }

  public rejectApproval(callId: string, reason: string): void {
    const pending = this.pendingApprovals.get(callId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pending.toolCall.status = 'rejected';
      pending.toolCall.error = reason;
      pending.resolve(false);
      this.pendingApprovals.delete(callId);
    }
  }

  public getPendingApprovals(): ToolCall[] {
    return Array.from(this.pendingApprovals.values()).map(p => p.toolCall);
  }
}
