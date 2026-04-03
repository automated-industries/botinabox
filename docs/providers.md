# LLM Providers

Providers implement the `LLMProvider` interface from `@botinabox/shared` and are registered with the `ProviderRegistry`.

## Built-in Providers

### Anthropic

```bash
pnpm add @botinabox/provider-anthropic
```

```typescript
import createAnthropicProvider from '@botinabox/provider-anthropic';

const provider = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

**Supported models:**

| Model ID | Context | Max Output | Capabilities |
|----------|---------|------------|--------------|
| `claude-opus-4-6` | 200k | 32k | chat, tools, vision, streaming |
| `claude-sonnet-4-6` | 200k | 16k | chat, tools, vision, streaming |
| `claude-haiku-4-5` | 200k | 8192 | chat, tools, vision, streaming |

Config in `botinabox.config.yml`:

```yaml
providers:
  anthropic:
    enabled: true
    apiKey: ${ANTHROPIC_API_KEY}
```

### OpenAI

```bash
pnpm add @botinabox/provider-openai
```

```typescript
import createOpenAIProvider from '@botinabox/provider-openai';

const provider = createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});
```

**Supported models:**

| Model ID | Context | Max Output | Capabilities |
|----------|---------|------------|--------------|
| `gpt-4o` | 128k | 16384 | chat, tools, vision, streaming |
| `gpt-4o-mini` | 128k | 16384 | chat, tools, vision, streaming |
| `o3-mini` | 200k | 100k | chat, tools, streaming |

Config:

```yaml
providers:
  openai:
    enabled: true
    apiKey: ${OPENAI_API_KEY}
```

### Ollama

```bash
pnpm add @botinabox/provider-ollama
```

```typescript
import createOllamaProvider from '@botinabox/provider-ollama';

const provider = createOllamaProvider({
  baseUrl: 'http://localhost:11434', // default
});
```

Ollama dynamically discovers available models by querying the `/api/tags` endpoint. Model info is cached for 5 minutes.

Config:

```yaml
providers:
  ollama:
    enabled: true
    baseUrl: http://localhost:11434
```

## Provider Registry

```typescript
import { ProviderRegistry } from '@botinabox/core';

const registry = new ProviderRegistry();

// Register
registry.register(provider);

// Lookup
const anthropic = registry.get('anthropic');

// List all providers
const all = registry.list();

// List all available models across providers
const models = registry.listModels();

// Remove
registry.unregister('anthropic');
```

## Model Router

The `ModelRouter` resolves model references (IDs or aliases) to a specific provider + model pair, and handles fallback chains.

```typescript
import { ModelRouter } from '@botinabox/core';

const router = new ModelRouter(registry, config.models);

// Resolve an alias
const resolved = router.resolve('smart');
// → { provider: 'anthropic', model: 'claude-opus-4-6' }

// Resolve with fallback (throws if nothing available)
const model = router.resolveWithFallback('smart');

// Resolve by purpose
const conversationModel = router.resolveForPurpose('conversation');
// Uses models.routing config to find the right model

// List all available models
const available = router.listAvailable();
```

### Aliases

Aliases map short names to model IDs:

```yaml
models:
  aliases:
    fast: claude-haiku-4-5
    smart: claude-opus-4-6
    balanced: claude-sonnet-4-6
```

Use aliases in agent definitions instead of hard-coding model IDs — this lets you change the underlying model without updating every agent.

### Routing

Purpose-based routing selects models by task type:

```yaml
models:
  routing:
    conversation: fast        # Chat messages use fast model
    task_execution: smart     # Agent tasks use powerful model
    classification: fast      # Intent classification uses fast model
```

### Fallback Chain

If the primary model/provider is unavailable, the router tries models in order:

```yaml
models:
  fallbackChain:
    - claude-sonnet-4-6
    - gpt-4o
    - llama3
```

## Auto-Discovery

Providers are auto-discovered from installed `@botinabox/*` packages that have `"botinabox": { "type": "provider" }` in their `package.json`.

```typescript
import { discoverProviders } from '@botinabox/core';

const providers = await discoverProviders('./node_modules');
providers.forEach(p => registry.register(p));
```

## Cost Tracking

The `CostTracker` listens for `run.completed` events, calculates cost from token usage and model pricing, and updates the agent's monthly spend.

```typescript
import { setupCostTracker } from '@botinabox/core';

setupCostTracker(hooks, db, {
  modelCatalog: registry.listModels(),
});
```

Cost data is recorded in the `cost_events` table and aggregated on the `agents.spent_monthly_cents` column.

## Writing a Custom Provider

Implement the `LLMProvider` interface:

```typescript
import type { LLMProvider, ChatParams, ChatResult, ModelInfo, ToolDefinition } from '@botinabox/shared';

const myProvider: LLMProvider = {
  id: 'my-provider',
  displayName: 'My Provider',
  models: [
    {
      id: 'my-model',
      displayName: 'My Model',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      capabilities: ['chat', 'tools'],
      inputCostPerMToken: 100,    // micro-cents per 1M tokens
      outputCostPerMToken: 300,
    },
  ],

  async chat(params: ChatParams): Promise<ChatResult> {
    // Call your API, return ChatResult
  },

  async *chatStream(params: ChatParams): AsyncGenerator<string, ChatResult> {
    // Yield text chunks, return final ChatResult
  },

  serializeTools(tools: ToolDefinition[]): unknown {
    // Convert generic tool definitions to your API's format
    return tools;
  },
};

export default function createMyProvider(config: { apiKey: string }): LLMProvider {
  return myProvider;
}
```

Add `"botinabox": { "type": "provider" }` to your `package.json` for auto-discovery.

## Tool Loop

The `toolLoop` generator implements the standard agentic tool-use cycle:

```typescript
import { toolLoop } from '@botinabox/core';

for await (const event of toolLoop(
  {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'What files are in the current directory?' }],
    tools: [listFilesTool],
    maxIterations: 20,
  },
  (params) => provider.chat(params),
  async (name, input) => {
    // Execute the tool and return result string
    return JSON.stringify(await runTool(name, input));
  }
)) {
  if (event.type === 'text') console.log(event.content);
  if (event.type === 'tool_use') console.log(`Calling: ${event.name}`);
  if (event.type === 'done') console.log('Final result:', event.result);
}
```

The loop repeats until the LLM returns `end_turn` (no more tool calls) or the max iteration limit is reached.
