import { Pool, PoolConfig } from 'pg';
import { MCPTool } from '../types.js';
import { z } from 'zod';

export class PostgresMCPServer {
  private pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  public getTools(): MCPTool[] {
    return [
      {
        name: 'postgres_query',
        description: 'Wykonuje zapytanie SQL (SELECT)',
        inputSchema: z.object({
          query: z.string(),
          params: z.array(z.any()).optional()
        }),
        execute: async (args) => await this.executeQuery(args)
      },
      {
        name: 'postgres_execute',
        description: 'Wykonuje zapytanie SQL modyfikujące dane (INSERT, UPDATE, DELETE)',
        inputSchema: z.object({
          query: z.string(),
          params: z.array(z.any()).optional()
        }),
        execute: async (args) => await this.executeCommand(args)
      },
      {
        name: 'postgres_list_tables',
        description: 'Lista tabel w bazie danych',
        inputSchema: z.object({}),
        execute: async () => await this.listTables()
      },
      {
        name: 'postgres_describe_table',
        description: 'Opisuje strukturę tabeli',
        inputSchema: z.object({
          tableName: z.string()
        }),
        execute: async (args) => await this.describeTable(args)
      }
    ];
  }

  private async executeQuery(args: { query: string; params?: any[] }) {
    // Walidacja: tylko SELECT
    if (!args.query.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('To narzędzie obsługuje tylko zapytania SELECT. Użyj postgres_execute dla modyfikacji.');
    }

    const result = await this.pool.query(args.query, args.params);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      fields: result.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID }))
    };
  }

  private async executeCommand(args: { query: string; params?: any[] }) {
    const result = await this.pool.query(args.query, args.params);
    return {
      rowCount: result.rowCount,
      command: result.command
    };
  }

  private async listTables() {
    const result = await this.pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

    return { tables: result.rows.map(r => r.table_name) };
  }

  private async describeTable(args: { tableName: string }) {
    const result = await this.pool.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [args.tableName]);

    return {
      tableName: args.tableName,
      columns: result.rows
    };
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
