import type { ModelInfo } from '@botinabox/shared';

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    inputCostPerMToken: 15,
    outputCostPerMToken: 75,
    capabilities: ['chat', 'tools', 'vision', 'streaming'],
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200000,
    maxOutputTokens: 16000,
    inputCostPerMToken: 3,
    outputCostPerMToken: 15,
    capabilities: ['chat', 'tools', 'vision', 'streaming'],
  },
  {
    id: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPerMToken: 0.8,
    outputCostPerMToken: 4,
    capabilities: ['chat', 'tools', 'vision', 'streaming'],
  },
];
