export interface SanitizerOptions {
  fieldLengthLimits?: Record<string, number>; // col name → max bytes. Default: 65535
  truncateSuffix?: string; // Default: '[truncated]'
}

export interface AuditEvent {
  table: string;
  operation: 'insert' | 'update' | 'delete';
  pk: unknown;
  timestamp: number;
  changedColumns?: string[];
}
