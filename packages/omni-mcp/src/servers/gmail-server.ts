import { google } from 'googleapis';
import { MCPTool } from '../types.js';
import { z } from 'zod';

export class GmailMCPServer {
  private oauth2Client: any;
  private gmail: any;

  constructor(credentials: any) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    );
    this.oauth2Client.setCredentials({
      refresh_token: credentials.refresh_token
    });
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  public getTools(): MCPTool[] {
    return [
      {
        name: 'gmail_send',
        description: 'Wysyła email przez Gmail',
        inputSchema: z.object({
          to: z.string().email(),
          subject: z.string(),
          body: z.string(),
          cc: z.string().optional(),
          bcc: z.string().optional()
        }),
        execute: async (args) => await this.sendEmail(args)
      },
      {
        name: 'gmail_list',
        description: 'Lista ostatnich emaili',
        inputSchema: z.object({
          maxResults: z.number().default(10),
          query: z.string().optional()
        }),
        execute: async (args) => await this.listEmails(args)
      },
      {
        name: 'gmail_read',
        description: 'Odczytuje treść emaila',
        inputSchema: z.object({
          messageId: z.string()
        }),
        execute: async (args) => await this.readEmail(args)
      },
      {
        name: 'gmail_search',
        description: 'Wyszukuje emaile',
        inputSchema: z.object({
          query: z.string(),
          maxResults: z.number().default(10)
        }),
        execute: async (args) => await this.searchEmails(args)
      }
    ];
  }

  private async sendEmail(args: { to: string; subject: string; body: string; cc?: string; bcc?: string }) {
    const raw = [
      `To: ${args.to}`,
      args.cc && `Cc: ${args.cc}`,
      args.bcc && `Bcc: ${args.bcc}`,
      `Subject: ${args.subject}`,
      '',
      args.body
    ].filter(Boolean).join('\n');

    const encodedMessage = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const response = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    return { messageId: response.data.id, threadId: response.data.threadId };
  }

  private async listEmails(args: { maxResults: number; query?: string }) {
    const response = await this.gmail.users.messages.list({
      userId: 'me',
      maxResults: args.maxResults,
      q: args.query
    });

    const messages = response.data.messages || [];
    const emails: Array<{ id: any; from: any; subject: any; date: any; snippet: any }> = [];

    for (const msg of messages) {
      const detail = await this.gmail.users.messages.get({
        userId: 'me',
        id: msg.id
      });

      const headers = detail.data.payload.headers;
      const from = headers.find((h: any) => h.name === 'From')?.value || '';
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
      const date = headers.find((h: any) => h.name === 'Date')?.value || '';

      emails.push({
        id: msg.id,
        from,
        subject,
        date,
        snippet: detail.data.snippet
      });
    }

    return { emails };
  }

  private async readEmail(args: { messageId: string }) {
    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: args.messageId,
      format: 'full'
    });

    const headers = response.data.payload.headers;
    const from = headers.find((h: any) => h.name === 'From')?.value || '';
    const to = headers.find((h: any) => h.name === 'To')?.value || '';
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
    const date = headers.find((h: any) => h.name === 'Date')?.value || '';

    let body = '';
    if (response.data.payload.body?.data) {
      body = Buffer.from(response.data.payload.body.data, 'base64').toString('utf-8');
    } else if (response.data.payload.parts) {
      for (const part of response.data.payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          break;
        }
      }
    }

    return { id: args.messageId, from, to, subject, date, body };
  }

  private async searchEmails(args: { query: string; maxResults: number }) {
    return await this.listEmails({ maxResults: args.maxResults, query: args.query });
  }
}
