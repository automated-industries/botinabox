/**
 * SystemContextBuilder — loads entity data from the database and formats
 * it as markdown for injection into LLM system prompts.
 *
 * Used by both the ChatPipeline (ack layer) and ExecutionEngine (agent layer)
 * to give LLMs awareness of the system state.
 */

import type { DataStore } from './data-store.js';

export interface SystemContextOptions {
  /** Include users. Default: true */
  users?: boolean;
  /** Include agents. Default: true */
  agents?: boolean;
  /** Include projects. Default: true */
  projects?: boolean;
  /** Include clients. Default: true */
  clients?: boolean;
  /** Include files. Default: true */
  files?: boolean;
  /** Include org. Default: true */
  org?: boolean;
}

/**
 * Build a markdown-formatted system context string from the database.
 * Queries users, agents, projects, clients, files, and org.
 */
export async function buildSystemContext(
  db: DataStore,
  options?: SystemContextOptions,
): Promise<string> {
  const opts = {
    users: true, agents: true, projects: true,
    clients: true, files: true, org: true,
    ...options,
  };

  const sections: string[] = [];

  if (opts.org) {
    const orgs = await db.query('org').catch(() => []);
    const org = orgs[0];
    if (org) {
      sections.push(`## Organization\n${org.name} — ${org.description ?? ''}`);
    }
  }

  if (opts.users) {
    const users = await db.query('users').catch(() => []);
    if (users.length > 0) {
      const list = users.map(u => `- ${u.name} (${u.role}${u.email ? `, ${u.email}` : ''})`).join('\n');
      sections.push(`## Users (${users.length})\n${list}`);
    }
  }

  if (opts.clients) {
    const clients = await db.query('client').catch(() => []);
    if (clients.length > 0) {
      const list = clients.map(c => `- ${c.name} (${c.status ?? 'active'})`).join('\n');
      sections.push(`## Clients (${clients.length})\n${list}`);
    }
  }

  if (opts.projects) {
    const projects = await db.query('project').catch(() => []);
    if (projects.length > 0) {
      const list = projects.map(p => `- ${p.name} (${p.status ?? 'unknown'})`).join('\n');
      sections.push(`## Projects (${projects.length})\n${list}`);
    }
  }

  if (opts.files) {
    const files = await db.query('file').catch(() => []);
    if (files.length > 0) {
      const list = files.map(f =>
        `- ${f.name}${f.file_path ? ` | path: ${f.file_path}` : ''}${f.access_level ? ` (${f.access_level})` : ''}`
      ).join('\n');
      sections.push(`## Files (${files.length})\n${list}`);
    }
  }

  if (opts.agents) {
    const agents = await db.query('agents').catch(() => []);
    if (agents.length > 0) {
      const list = agents.map(a => `- ${a.name} (${a.role}, ${a.status})`).join('\n');
      sections.push(`## Agents (${agents.length})\n${list}`);
    }
  }

  return sections.join('\n\n');
}
