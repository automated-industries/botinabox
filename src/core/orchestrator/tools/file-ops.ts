/**
 * Built-in tools: File operations — list, register, send, read.
 */
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const listFilesTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'list_files',
    description: 'List all files in the system. Shows file names, types, access levels, and paths. Use when the user asks "what files do we have?" or needs to find a document.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional search term to filter files by name' },
      },
    },
  },
  handler: async (input, ctx) => {
    const files = await ctx.db.query('file');
    let results = files.filter(f => !f.deleted_at);
    const search = input.search as string | undefined;
    if (search) {
      const lower = search.toLowerCase();
      results = results.filter(f => ((f.name as string) ?? '').toLowerCase().includes(lower));
    }
    if (results.length === 0) return 'No files found.';
    return results.map(f => `- ${f.name} (${f.access_level ?? 'internal'}) | ${f.file_path ?? 'no path'}`).join('\n');
  },
};

export const registerFileTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'register_file',
    description: 'Register a new file in the vault for tracking. Use when a new document needs to be tracked by the system.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name/title' },
        file_path: { type: 'string', description: 'Path to the file on disk' },
        mime_type: { type: 'string', description: 'MIME type (e.g. application/pdf)' },
        access_level: { type: 'string', description: 'Access level: internal, confidential, public' },
      },
      required: ['name', 'file_path'],
    },
  },
  handler: async (input, ctx) => {
    const orgs = await ctx.db.query('org');
    const orgId = orgs[0]?.id as string ?? '';
    const row = await ctx.db.insert('file', {
      org_id: orgId,
      name: input.name,
      file_path: input.file_path,
      mime_type: input.mime_type ?? 'application/octet-stream',
      access_level: input.access_level ?? 'internal',
    });
    return `File "${input.name}" registered with ID ${row.id}.`;
  },
};
