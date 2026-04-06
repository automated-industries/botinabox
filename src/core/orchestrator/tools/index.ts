/**
 * Built-in tools for the ExecutionEngine.
 * 22 tools across 6 modules. All channel-agnostic.
 */

// File operations
export { sendFileTool } from './send-file.js';
export { readFileTool } from './read-file.js';
export { listFilesTool, registerFileTool } from './file-ops.js';

// Task operations
export { dispatchTaskTool, cancelTaskTool, reassignTaskTool } from './task-ops.js';

// System awareness
export { getTaskStatusTool, getAgentStatusTool, getSystemStatusTool, getActiveTasksTool } from './status.js';

// Entity lookup
export { listAgentsTool, listProjectsTool, getAgentDetailTool } from './roster.js';

// Communication (channel-agnostic: slack, email, discord, sms)
export { sendMessageTool, addTaskCommentTool, readConversationTool, searchConversationTool } from './messaging.js';

// Entity creation
export { createAgentTool, createProjectTool } from './management.js';
