import { Client } from '@notionhq/client';
import { MCPTool } from '../types.js';
import { z } from 'zod';

export class NotionMCPServer {
  private client: Client;

  constructor(apiKey: string) {
    this.client = new Client({ auth: apiKey });
  }

  public getTools(): MCPTool[] {
    return [
      {
        name: 'notion_search',
        description: 'Wyszukuje strony i bazy danych w Notion',
        inputSchema: z.object({
          query: z.string(),
          filter: z.object({
            value: z.enum(['page', 'database']),
            property: z.literal('object')
          }).optional()
        }),
        execute: async (args) => await this.search(args)
      },
      {
        name: 'notion_get_page',
        description: 'Pobiera zawartość strony Notion',
        inputSchema: z.object({
          pageId: z.string()
        }),
        execute: async (args) => await this.getPage(args)
      },
      {
        name: 'notion_create_page',
        description: 'Tworzy nową stronę w Notion',
        inputSchema: z.object({
          parentId: z.string(),
          title: z.string(),
          content: z.string()
        }),
        execute: async (args) => await this.createPage(args)
      },
      {
        name: 'notion_query_database',
        description: 'Wykonuje zapytanie do bazy danych Notion',
        inputSchema: z.object({
          databaseId: z.string(),
          filter: z.any().optional(),
          sorts: z.any().optional()
        }),
        execute: async (args) => await this.queryDatabase(args)
      }
    ];
  }

  private async search(args: { query: string; filter?: any }) {
    const response = await this.client.search({
      query: args.query,
      filter: args.filter
    });

    return {
      results: response.results.map(r => ({
        id: r.id,
        type: r.object,
        title: this.extractTitle(r),
        url: (r as any).url
      }))
    };
  }

  private async getPage(args: { pageId: string }) {
    const page = await this.client.pages.retrieve({ page_id: args.pageId });
    const blocks = await this.client.blocks.children.list({ block_id: args.pageId });

    return {
      page: {
        id: page.id,
        title: this.extractTitle(page),
        url: (page as any).url,
        createdTime: (page as any).created_time,
        lastEditedTime: (page as any).last_edited_time
      },
      content: blocks.results.map(b => this.extractBlockContent(b))
    };
  }

  private async createPage(args: { parentId: string; title: string; content: string }) {
    const response = await this.client.pages.create({
      parent: { page_id: args.parentId },
      properties: {
        title: {
          title: [
            {
              text: {
                content: args.title
              }
            }
          ]
        }
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: args.content
                }
              }
            ]
          }
        }
      ]
    });

    return {
      pageId: response.id,
      url: (response as any).url
    };
  }

  private async queryDatabase(args: { databaseId: string; filter?: any; sorts?: any }) {
    const response = await this.client.databases.query({
      database_id: args.databaseId,
      filter: args.filter,
      sorts: args.sorts
    });

    return {
      results: response.results.map(r => ({
        id: r.id,
        properties: (r as any).properties,
        url: (r as any).url
      }))
    };
  }

  private extractTitle(obj: any): string {
    if (obj.object === 'page') {
      const titleProp = Object.values(obj.properties).find((p: any) => p.type === 'title');
      if (titleProp && (titleProp as any).title?.[0]) {
        return (titleProp as any).title[0].plain_text;
      }
    }
    return obj.title?.[0]?.plain_text || 'Untitled';
  }

  private extractBlockContent(block: any): any {
    const type = block.type;
    const content = block[type];
    
    if (content?.rich_text) {
      return {
        type,
        text: content.rich_text.map((rt: any) => rt.plain_text).join('')
      };
    }
    
    return { type, content };
  }
}
