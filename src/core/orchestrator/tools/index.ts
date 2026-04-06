/**
 * Built-in tools for the ExecutionEngine.
 * 20 tools across 6 modules. All channel-agnostic.
 */

// File operations
import { sendFileTool } from './send-file.js';
import { readFileTool } from './read-file.js';
import { listFilesTool, registerFileTool } from './file-ops.js';

// Task operations
import { dispatchTaskTool, cancelTaskTool, reassignTaskTool } from './task-ops.js';

// System awareness
import { getTaskStatusTool, getAgentStatusTool, getSystemStatusTool, getActiveTasksTool } from './status.js';

// Entity lookup
import { listAgentsTool, listProjectsTool, getAgentDetailTool } from './roster.js';

// Communication (channel-agnostic: slack, email, discord, sms)
import { sendMessageTool, addTaskCommentTool, readConversationTool, searchConversationTool } from './messaging.js';

// Entity creation
import { createAgentTool, createProjectTool } from './management.js';

// Individual exports (backwards-compatible)
export {
  sendFileTool, readFileTool, listFilesTool, registerFileTool,
  dispatchTaskTool, cancelTaskTool, reassignTaskTool,
  getTaskStatusTool, getAgentStatusTool, getSystemStatusTool, getActiveTasksTool,
  listAgentsTool, listProjectsTool, getAgentDetailTool,
  sendMessageTool, addTaskCommentTool, readConversationTool, searchConversationTool,
  createAgentTool, createProjectTool,
};

/**
 * All native tools bundled for convenience.
 * Apps can pass this directly to ExecutionEngine config:
 *   tools: nativeTools
 * or spread to add custom tools:
 *   tools: [...nativeTools, myCustomTool]
 */
export const nativeTools = [
  sendFileTool, readFileTool, listFilesTool, registerFileTool,
  dispatchTaskTool, cancelTaskTool, reassignTaskTool,
  getTaskStatusTool, getAgentStatusTool, getSystemStatusTool, getActiveTasksTool,
  listAgentsTool, listProjectsTool, getAgentDetailTool,
  sendMessageTool, addTaskCommentTool, readConversationTool, searchConversationTool,
  createAgentTool, createProjectTool,
];
