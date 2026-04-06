/**
 * Built-in tools: Communication — send messages, read conversations, search history.
 * All messaging is channel-agnostic: slack, email, discord, sms — same tools.
 */
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const sendMessageTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'send_message',
    description: 'Send a message to a user or channel. Works across any channel: slack, email, discord, sms. For email, set channel="email" and include subject in the message. Use when the user asks to send/email/message someone.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel: "slack", "email", "discord", etc.' },
        recipient: { type: 'string', description: 'Recipient: Slack user ID, email address, channel name, etc.' },
        text: { type: 'string', description: 'Message body' },
        subject: { type: 'string', description: 'Subject line (for email channel)' },
      },
      required: ['channel', 'recipient', 'text'],
    },
  },
  handler: async (input, ctx) => {
    await ctx.hooks.emit('message.send', {
      channel: input.channel,
      recipient: input.recipient,
      text: input.text,
      subject: input.subject,
      taskId: ctx.taskId,
    });
    return `Message sent to ${input.recipient} via ${input.channel}.`;
  },
};

export const addTaskCommentTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'add_task_comment',
    description: 'Add a progress update or comment to a task. This syncs back to the Slack thread where the task was created. Use for mid-task status updates.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to comment on' },
        comment: { type: 'string', description: 'Progress update text' },
      },
      required: ['task_id', 'comment'],
    },
  },
  handler: async (input, ctx) => {
    const task = await ctx.db.get('tasks', { id: input.task_id });
    if (!task) return `Task ${input.task_id} not found.`;
    const result = ((task.result as string) ?? '') + `\n\n---\n${input.comment}`;
    await ctx.db.update('tasks', { id: input.task_id }, { result });

    // Try to deliver to Slack thread
    const mappings = await ctx.db.query('thread_task_map', { where: { task_id: input.task_id } });
    if (mappings.length > 0) {
      await ctx.hooks.emit('response.ready', {
        text: input.comment,
        channel: 'slack',
        threadId: mappings[0]!.thread_ts,
        taskId: input.task_id,
      });
    }
    return `Comment added to task "${task.title}".`;
  },
};

export const readConversationTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'read_conversation',
    description: 'Read recent messages from a channel or conversation. Use when you need context about what was discussed recently.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (e.g. "slack")' },
        limit: { type: 'number', description: 'Number of recent messages to read. Default: 20' },
      },
      required: ['channel'],
    },
  },
  handler: async (input, ctx) => {
    const limit = (input.limit as number) ?? 20;
    const messages = await ctx.db.query('messages', {
      where: { channel: input.channel },
      orderBy: 'created_at',
      limit,
    });
    if (messages.length === 0) return `No messages found in ${input.channel}.`;
    return messages.map(m => {
      const dir = m.direction === 'inbound' ? '→' : '←';
      const who = (m.from_user as string) ?? (m.from_agent as string) ?? 'unknown';
      return `${dir} ${who}: ${((m.body as string) ?? '').slice(0, 200)}`;
    }).join('\n');
  },
};

export const searchConversationTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'search_conversation',
    description: 'Search message history across all channels by keyword. Use when looking for a specific discussion, decision, or topic that was mentioned previously.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        limit: { type: 'number', description: 'Max results. Default: 10' },
      },
      required: ['query'],
    },
  },
  handler: async (input, ctx) => {
    const query = input.query as string;
    const limit = (input.limit as number) ?? 10;
    // SQLite LIKE search
    const messages = await ctx.db.query('messages', {
      filters: [{ col: 'body', op: 'like', val: `%${query}%` }],
      orderBy: 'created_at',
      limit,
    });
    if (messages.length === 0) return `No messages found matching "${query}".`;
    return messages.map(m => {
      const who = (m.from_user as string) ?? (m.from_agent as string) ?? 'unknown';
      const ts = (m.created_at as string)?.slice(0, 16) ?? '';
      return `[${ts}] ${who}: ${((m.body as string) ?? '').slice(0, 150)}`;
    }).join('\n');
  },
};
