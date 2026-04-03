import type { LLMProvider } from "../../shared/index.js";
import { AnthropicProvider } from './provider.js';
import { MODELS } from './models.js';

export { AnthropicProvider, MODELS };

export default function createAnthropicProvider(config: {
  apiKey: string;
}): LLMProvider {
  return new AnthropicProvider(config);
}
