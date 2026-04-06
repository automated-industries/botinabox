/**
 * Built-in tool: send_file — delivers a file to the user via the channel.
 */
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const sendFileTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'send_file',
    description: 'Send/deliver/attach a file to the user on Slack. Use this when the user asks for a document, contract, report, or any file. The file_path is in the Files section of your system context.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file (from system context)' },
      },
      required: ['file_path'],
    },
  },
  handler: async (input, context) => {
    const rawPath = input.file_path as string;
    const filePath = context.resolveFilePath?.(rawPath) ?? rawPath;
    if (!existsSync(filePath)) return `Error: file not found at ${filePath}`;
    await context.hooks.emit('file.deliver', {
      filePath,
      fileName: basename(filePath),
      taskId: context.taskId,
    });
    return `File "${basename(filePath)}" sent to user.`;
  },
};
