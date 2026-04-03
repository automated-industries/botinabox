import type { LLMProvider } from "../../shared/index.js";
import { OllamaProvider } from './provider.js';

export { OllamaProvider };

export default function createOllamaProvider(config?: {
  baseUrl?: string;
}): LLMProvider {
  return new OllamaProvider(config);
}
