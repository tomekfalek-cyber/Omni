import { MCPClient } from './client.js';
import { MCPClientConfig, MCPTool } from './types.js';

export class MCPRegistry {
  private clients: Map<string, MCPClient> = new Map();
  private tools: Map<string, { clientName: string; tool: MCPTool }> = new Map();

  public async registerServer(config: MCPClientConfig): Promise<void> {
    const client = new MCPClient(config);
    await client.start();

    this.clients.set(config.serverName, client);

    // Rejestracja narzędzi z prefixem nazwy serwera
    const tools = client.getTools();
    for (const tool of tools) {
      const prefixedName = `${config.serverName}__${tool.name}`;
      this.tools.set(prefixedName, {
        clientName: config.serverName,
        tool: {
          ...tool,
          name: prefixedName
        }
      });
    }

    console.log(`[MCPRegistry] Zarejestrowano serwer: ${config.serverName} (${tools.length} narzędzi)`);
  }

  public async unregisterServer(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (client) {
      await client.stop();
      this.clients.delete(serverName);

      // Usuń narzędzia tego serwera
      for (const [key, value] of this.tools) {
        if (value.clientName === serverName) {
          this.tools.delete(key);
        }
      }

      console.log(`[MCPRegistry] Wyrejestrowano serwer: ${serverName}`);
    }
  }

  public getTool(name: string): MCPTool | undefined {
    return this.tools.get(name)?.tool;
  }

  public getAllTools(): MCPTool[] {
    return Array.from(this.tools.values()).map(v => v.tool);
  }

  public async executeTool(name: string, args: any): Promise<any> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(`Nie znaleziono narzędzia MCP: ${name}`);
    }

    return await entry.tool.execute(args);
  }

  public async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.stop();
    }
    this.clients.clear();
    this.tools.clear();
  }
}
