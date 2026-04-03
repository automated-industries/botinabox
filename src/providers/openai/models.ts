import type { ModelInfo } from "../../shared/index.js";

export const MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPerMToken: 2.5,
    outputCostPerMToken: 10,
    capabilities: ['chat', 'tools', 'vision', 'streaming'],
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPerMToken: 0.15,
    outputCostPerMToken: 0.6,
    capabilities: ['chat', 'tools', 'vision', 'streaming'],
  },
  {
    id: 'o3-mini',
    displayName: 'o3 Mini',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputCostPerMToken: 1.1,
    outputCostPerMToken: 4.4,
    capabilities: ['chat', 'tools', 'streaming'],
  },
];
