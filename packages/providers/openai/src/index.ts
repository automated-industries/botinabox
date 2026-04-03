import type { LLMProvider } from '@botinabox/shared';
import { OpenAIProvider } from './provider.js';
import { MODELS } from './models.js';

export { OpenAIProvider, MODELS };

export default function createOpenAIProvider(config: {
  apiKey: string;
}): LLMProvider {
  return new OpenAIProvider(config);
}
