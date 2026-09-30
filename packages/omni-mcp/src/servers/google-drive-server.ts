import { google } from 'googleapis';
import { MCPTool } from '../types.js';
import { z } from 'zod';
import * as fs from 'fs/promises';

export class GoogleDriveMCPServer {
  private drive: any;

  constructor(credentials: any) {
    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    );
    oauth2Client.setCredentials({
      refresh_token: credentials.refresh_token
    });
    this.drive = google.drive({ version: 'v3', auth: oauth2Client });
  }

  public getTools(): MCPTool[] {
    return [
      {
        name: 'drive_list_files',
        description: 'Lista plików w Google Drive',
        inputSchema: z.object({
          query: z.string().optional(),
          pageSize: z.number().default(20)
        }),
        execute: async (args) => await this.listFiles(args)
      },
      {
        name: 'drive_get_file',
        description: 'Pobiera metadane pliku',
        inputSchema: z.object({
          fileId: z.string()
        }),
        execute: async (args) => await this.getFile(args)
      },
      {
        name: 'drive_download_file',
        description: 'Pobiera zawartość pliku',
        inputSchema: z.object({
          fileId: z.string(),
          outputPath: z.string()
        }),
        execute: async (args) => await this.downloadFile(args)
      },
      {
        name: 'drive_upload_file',
        description: 'Przesyła plik do Google Drive',
        inputSchema: z.object({
          filePath: z.string(),
          name: z.string(),
          mimeType: z.string().optional(),
          parentId: z.string().optional()
        }),
        execute: async (args) => await this.uploadFile(args)
      }
    ];
  }

  private async listFiles(args: { query?: string; pageSize: number }) {
    const response = await this.drive.files.list({
      q: args.query,
      pageSize: args.pageSize,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)'
    });

    return {
      files: response.data.files.map((f: any) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        createdTime: f.createdTime,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink
      }))
    };
  }

  private async getFile(args: { fileId: string }) {
    const response = await this.drive.files.get({
      fileId: args.fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents'
    });

    return response.data;
  }

  private async downloadFile(args: { fileId: string; outputPath: string }) {
    const response = await this.drive.files.get(
      { fileId: args.fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(args.outputPath);
      response.data.on('error', reject).pipe(dest);
      dest.on('error', reject);
      dest.on('finish', resolve);
    });

    return { outputPath: args.outputPath };
  }

  private async uploadFile(args: { filePath: string; name: string; mimeType?: string; parentId?: string }) {
    const fileMetadata: any = {
      name: args.name
    };

    if (args.parentId) {
      fileMetadata.parents = [args.parentId];
    }

    const media = {
      mimeType: args.mimeType || 'application/octet-stream',
      body: fs.createReadStream(args.filePath)
    };

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, webViewLink'
    });

    return {
      fileId: response.data.id,
      name: response.data.name,
      webViewLink: response.data.webViewLink
    };
  }
}
