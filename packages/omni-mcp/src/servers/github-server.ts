import { Octokit } from '@octokit/rest';
import { MCPTool } from '../types.js';
import { z } from 'zod';

export class GitHubMCPServer {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  public getTools(): MCPTool[] {
    return [
      {
        name: 'github_list_repos',
        description: 'Lista repozytoriów użytkownika',
        inputSchema: z.object({
          type: z.enum(['all', 'owner', 'public', 'private', 'member']).default('all')
        }),
        execute: async (args) => await this.listRepos(args)
      },
      {
        name: 'github_get_repo',
        description: 'Pobiera informacje o repozytorium',
        inputSchema: z.object({
          owner: z.string(),
          repo: z.string()
        }),
        execute: async (args) => await this.getRepo(args)
      },
      {
        name: 'github_list_issues',
        description: 'Lista issues w repozytorium',
        inputSchema: z.object({
          owner: z.string(),
          repo: z.string(),
          state: z.enum(['open', 'closed', 'all']).default('open'),
          perPage: z.number().default(10)
        }),
        execute: async (args) => await this.listIssues(args)
      },
      {
        name: 'github_create_issue',
        description: 'Tworzy nowy issue',
        inputSchema: z.object({
          owner: z.string(),
          repo: z.string(),
          title: z.string(),
          body: z.string().optional(),
          labels: z.array(z.string()).optional()
        }),
        execute: async (args) => await this.createIssue(args)
      },
      {
        name: 'github_list_prs',
        description: 'Lista pull requestów',
        inputSchema: z.object({
          owner: z.string(),
          repo: z.string(),
          state: z.enum(['open', 'closed', 'all']).default('open')
        }),
        execute: async (args) => await this.listPRs(args)
      },
      {
        name: 'github_get_file',
        description: 'Pobiera zawartość pliku z repozytorium',
        inputSchema: z.object({
          owner: z.string(),
          repo: z.string(),
          path: z.string(),
          ref: z.string().default('main')
        }),
        execute: async (args) => await this.getFile(args)
      }
    ];
  }

  private async listRepos(args: { type: string }) {
    const response = await this.octokit.repos.listForAuthenticatedUser({
      type: args.type as any,
      per_page: 100
    });

    return {
      repos: response.data.map(r => ({
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        url: r.html_url
      }))
    };
  }

  private async getRepo(args: { owner: string; repo: string }) {
    const response = await this.octokit.repos.get({
      owner: args.owner,
      repo: args.repo
    });

    const r = response.data;
    return {
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      private: r.private,
      url: r.html_url,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      language: r.language,
      defaultBranch: r.default_branch
    };
  }

  private async listIssues(args: { owner: string; repo: string; state: string; perPage: number }) {
    const response = await this.octokit.issues.listForRepo({
      owner: args.owner,
      repo: args.repo,
      state: args.state as any,
      per_page: args.perPage
    });

    return {
      issues: response.data.map(i => ({
        number: i.number,
        title: i.title,
        state: i.state,
        author: i.user?.login,
        labels: i.labels.map(l => typeof l === 'string' ? l : l.name),
        createdAt: i.created_at,
        url: i.html_url
      }))
    };
  }

  private async createIssue(args: { owner: string; repo: string; title: string; body?: string; labels?: string[] }) {
    const response = await this.octokit.issues.create({
      owner: args.owner,
      repo: args.repo,
      title: args.title,
      body: args.body,
      labels: args.labels
    });

    return {
      number: response.data.number,
      url: response.data.html_url
    };
  }

  private async listPRs(args: { owner: string; repo: string; state: string }) {
    const response = await this.octokit.pulls.list({
      owner: args.owner,
      repo: args.repo,
      state: args.state as any,
      per_page: 50
    });

    return {
      prs: response.data.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login,
        branch: pr.head.ref,
        createdAt: pr.created_at,
        url: pr.html_url
      }))
    };
  }

  private async getFile(args: { owner: string; repo: string; path: string; ref: string }) {
    const response = await this.octokit.repos.getContent({
      owner: args.owner,
      repo: args.repo,
      path: args.path,
      ref: args.ref
    });

    const data = response.data as any;
    if (data.type !== 'file') {
      throw new Error('Ścieżka nie wskazuje na plik');
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return {
      path: data.path,
      content,
      sha: data.sha,
      size: data.size
    };
  }
}
