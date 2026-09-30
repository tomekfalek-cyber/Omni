import axios from 'axios';
import { MCPTool } from '../types.js';
import { z } from 'zod';

export class BraveSearchMCPServer {
  private apiKey: string;
  private baseUrl = 'https://api.search.brave.com/res/v1/web/search';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public getTools(): MCPTool[] {
    return [
      {
        name: 'brave_search',
        description: 'Wyszukuje w internecie przez Brave Search',
        inputSchema: z.object({
          query: z.string(),
          count: z.number().default(10),
          offset: z.number().default(0)
        }),
        execute: async (args) => await this.search(args)
      },
      {
        name: 'brave_news',
        description: 'Wyszukuje najnowsze wiadomości',
        inputSchema: z.object({
          query: z.string(),
          count: z.number().default(10)
        }),
        execute: async (args) => await this.news(args)
      }
    ];
  }

  private async search(args: { query: string; count: number; offset: number }) {
    const response = await axios.get(this.baseUrl, {
      params: {
        q: args.query,
        count: args.count,
        offset: args.offset
      },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey
      }
    });

    const results = response.data.web?.results || [];
    return {
      query: args.query,
      results: results.map((r: any) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        age: r.age
      }))
    };
  }

  private async news(args: { query: string; count: number }) {
    const response = await axios.get('https://api.search.brave.com/res/v1/news/search', {
      params: {
        q: args.query,
        count: args.count
      },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey
      }
    });

    const results = response.data.results || [];
    return {
      query: args.query,
      news: results.map((r: any) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        source: r.meta_url?.hostname,
        age: r.age
      }))
    };
  }
}
