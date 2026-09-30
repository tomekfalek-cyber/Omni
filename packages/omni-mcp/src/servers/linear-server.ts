import { LinearClient } from '@linear/sdk';
import { MCPTool } from '../types.js';
import { z } from 'zod';

export class LinearMCPServer {
  private client: LinearClient;

  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey });
  }

  public getTools(): MCPTool[] {
    return [
      {
        name: 'linear_list_issues',
        description: 'Lista issue w Linear',
        inputSchema: z.object({
          teamId: z.string().optional(),
          assigneeId: z.string().optional(),
          first: z.number().default(20)
        }),
        execute: async (args) => await this.listIssues(args)
      },
      {
        name: 'linear_get_issue',
        description: 'Pobiera szczegóły issue',
        inputSchema: z.object({
          issueId: z.string()
        }),
        execute: async (args) => await this.getIssue(args)
      },
      {
        name: 'linear_create_issue',
        description: 'Tworzy nowy issue',
        inputSchema: z.object({
          teamId: z.string(),
          title: z.string(),
          description: z.string().optional(),
          assigneeId: z.string().optional(),
          priority: z.number().optional()
        }),
        execute: async (args) => await this.createIssue(args)
      },
      {
        name: 'linear_list_teams',
        description: 'Lista zespołów',
        inputSchema: z.object({}),
        execute: async () => await this.listTeams()
      }
    ];
  }

  private async listIssues(args: { teamId?: string; assigneeId?: string; first: number }) {
    const filter: any = {};
    if (args.teamId) filter.team = { id: { eq: args.teamId } };
    if (args.assigneeId) filter.assignee = { id: { eq: args.assigneeId } };

    const issues = await this.client.issues({
      filter,
      first: args.first
    });

    return {
      issues: issues.nodes.map(i => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        description: i.description,
        state: i.state?.name,
        priority: i.priority,
        assignee: i.assignee?.name,
        url: i.url
      }))
    };
  }

  private async getIssue(args: { issueId: string }) {
    const issue = await this.client.issue(args.issueId);

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state?.name,
      priority: issue.priority,
      assignee: issue.assignee?.name,
      team: issue.team?.name,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt
    };
  }

  private async createIssue(args: { teamId: string; title: string; description?: string; assigneeId?: string; priority?: number }) {
    const issue = await this.client.createIssue({
      teamId: args.teamId,
      title: args.title,
      description: args.description,
      assigneeId: args.assigneeId,
      priority: args.priority
    });

    return {
      issueId: issue._issue?.id,
      identifier: issue._issue?.identifier,
      url: issue._issue?.url
    };
  }

  private async listTeams() {
    const teams = await this.client.teams();

    return {
      teams: teams.nodes.map(t => ({
        id: t.id,
        name: t.name,
        key: t.key
      }))
    };
  }
}
