# LLM Providers

botinabox supports multiple LLM providers through a unified interface. Each provider is a separate subpath import that you add only when needed -- peer dependencies are optional, so you install only the SDKs you use.

```bash
npm install botinabox
npm install @anthropic-ai/sdk   # only if using Anthropic
npm install openai               # only if using OpenAI
```

---

## Provider Registry

The `ProviderRegistry` manages all registered LLM providers. Register providers at startup, then look them up by ID anywhere in your application.

```typescript
import { ProviderRegistry } from 'botinabox';
import createAnthropicProvider from 'botinabox/anthropic';
import createOpenAIProvider from 'botinabox/openai';

const registry = new ProviderRegistry();

// Register providers
registry.register(createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }));
registry.register(createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }));

// Look up a provider by ID
const anthropic = registry.get('anthropic');

// List all registered providers
const providers = registry.list();
// => [AnthropicProvider, OpenAIProvider]

// List every model across all providers
const allModels = registry.listModels();
// => [{ id: 'claude-opus-4-6', ... }, { id: 'gpt-4o', ... }, ...]

// Remove a provider
registry.unregister('openai');
```

### API

| Method | Returns | Description |
|--------|---------|-------------|
| `register(provider)` | `void` | Add a provider. Throws if ID is already registered. |
| `unregister(id)` | `void` | Remove a provider by ID. |
| `get(id)` | `LLMProvider \| undefined` | Look up a provider. |
| `list()` | `LLMProvider[]` | All registered providers. |
| `listModels()` | `ModelInfo[]` | Aggregated model list from every provider. |

---

## Model Router

The `ModelRouter` resolves model aliases, routes by purpose, and walks fallback chains when a provider is unavailable.

```typescript
import { ProviderRegistry, ModelRouter } from 'botinabox';
import type { ModelConfig } from 'botinabox';

const modelConfig: ModelConfig = {
  default: 'balanced',
  aliases: {
    fast: 'claude-haiku-4-5',
    balanced: 'claude-sonnet-4-6',
    smart: 'claude-opus-4-6',
  },
  routing: {
    conversation: 'fast',
    task_execution: 'smart',
    classification: 'fast',
    summarization: 'balanced',
  },
  fallbackChain: ['claude-sonnet-4-6', 'gpt-4o'],
};

const router = new ModelRouter(registry, modelConfig);
```

### Resolve an alias

```typescript
const resolved = router.resolve('smart');
// => { provider: 'anthropic', model: 'claude-opus-4-6' }
```

### Resolve with fallback

If the requested model is not available from any registered provider, the router walks the `fallbackChain` in order. Throws if nothing is available.

```typescript
const model = router.resolveWithFallback('some-unavailable-model');
// Tries fallbackChain: claude-sonnet-4-6 -> gpt-4o
```

### Resolve by purpose

Maps a task purpose to a model via `routing` config, then resolves with fallback.

```typescript
const chatModel = router.resolveForPurpose('conversation');
// routing['conversation'] => 'fast' => aliases['fast'] => 'claude-haiku-4-5'

const taskModel = router.resolveForPurpose('task_execution');
// routing['task_execution'] => 'smart' => aliases['smart'] => 'claude-opus-4-6'
```

### List available models

```typescript
const available = router.listAvailable();
// Returns ModelInfo[] from all registered providers
```

### Configuration in YAML

```yaml
models:
  default: balanced
  aliases:
    fast: claude-haiku-4-5
    balanced: claude-sonnet-4-6
    smart: claude-opus-4-6
  routing:
    conversation: fast
    task_execution: smart
    classification: fast
  fallbackChain:
    - claude-sonnet-4-6
    - gpt-4o
    - llama3
  costLimit:
    perRunCents: 50
```

---

## Anthropic Provider

Import from `botinabox/anthropic`. Requires `@anthropic-ai/sdk` as a peer dependency.

```typescript
import createAnthropicProvider from 'botinabox/anthropic';
import { AnthropicProvider, MODELS } from 'botinabox/anthropic';

// Factory function (recommended)
const provider = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Or instantiate the class directly
const provider2 = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});
```

### Available Models

| Model ID | Display Name | Context | Max Output | Cost (input/output per 1M tokens) | Capabilities |
|----------|-------------|---------|------------|-----------------------------------|--------------|
| `claude-opus-4-6` | Claude Opus 4.6 | 200k | 32k | $15 / $75 | chat, tools, vision, streaming |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 200k | 16k | $3 / $15 | chat, tools, vision, streaming |
| `claude-haiku-4-5` | Claude Haiku 4.5 | 200k | 8,192 | $0.80 / $4 | chat, tools, vision, streaming |

### Chat

```typescript
const result = await provider.chat({
  model: 'claude-sonnet-4-6',
  messages: [
    { role: 'user', content: 'Explain TCP in one sentence.' },
  ],
  system: 'You are a networking expert.',
  maxTokens: 256,
  temperature: 0.3,
});

console.log(result.content);
// => "TCP is a reliable, connection-oriented transport protocol..."
console.log(result.usage);
// => { inputTokens: 42, outputTokens: 31 }
console.log(result.stopReason);
// => 'end_turn'
```

### Streaming

```typescript
const stream = provider.chatStream({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Write a haiku about code.' }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk); // Each chunk is a string of text
}

// The generator's return value is the full ChatResult
const finalResult = (await stream.next()).value as ChatResult;
```

### Tool Use

```typescript
import type { ToolDefinition, ChatMessage, ContentBlock } from 'botinabox';

const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: 'Get the current weather for a location.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
    },
    required: ['location'],
  },
};

// First call: model decides to use the tool
const result = await provider.chat({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
  tools: [weatherTool],
});

if (result.stopReason === 'tool_use' && result.toolUses) {
  const toolCall = result.toolUses[0];
  // toolCall => { id: 'toolu_123', name: 'get_weather', input: { location: 'Paris' } }

  // Execute the tool yourself
  const toolResult = JSON.stringify({ temp: '18C', condition: 'Partly cloudy' });

  // Send the tool result back
  const finalResult = await provider.chat({
    model: 'claude-sonnet-4-6',
    messages: [
      { role: 'user', content: 'What is the weather in Paris?' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.input },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: toolCall.id, content: toolResult },
        ],
      },
    ],
    tools: [weatherTool],
  });

  console.log(finalResult.content);
  // => "The weather in Paris is 18C and partly cloudy."
}
```

### YAML Config

```yaml
providers:
  anthropic:
    enabled: true
    apiKey: ${ANTHROPIC_API_KEY}
```

---

## OpenAI Provider

Import from `botinabox/openai`. Requires `openai` as a peer dependency.

```typescript
import createOpenAIProvider from 'botinabox/openai';
import { OpenAIProvider, MODELS } from 'botinabox/openai';

const provider = createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
});
```

### Available Models

| Model ID | Display Name | Context | Max Output | Cost (input/output per 1M tokens) | Capabilities |
|----------|-------------|---------|------------|-----------------------------------|--------------|
| `gpt-4o` | GPT-4o | 128k | 16,384 | $2.50 / $10 | chat, tools, vision, streaming |
| `gpt-4o-mini` | GPT-4o Mini | 128k | 16,384 | $0.15 / $0.60 | chat, tools, vision, streaming |
| `o3-mini` | o3 Mini | 200k | 100k | $1.10 / $4.40 | chat, tools, streaming |

### Chat

```typescript
const result = await provider.chat({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
  system: 'You are a helpful assistant.',
  maxTokens: 512,
});

console.log(result.content);
```

### Streaming

```typescript
const stream = provider.chatStream({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Tell me a joke.' }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

### Tool Use

OpenAI tool use works the same way as Anthropic -- the `ChatResult` normalizes OpenAI's `tool_calls` into the same `ToolUse[]` format. OpenAI's `finish_reason` values are mapped to the standard `stopReason`:

| OpenAI `finish_reason` | botinabox `stopReason` |
|------------------------|------------------------|
| `stop` | `end_turn` |
| `tool_calls` | `tool_use` |
| `length` | `max_tokens` |
| `content_filter` | `stop_sequence` |

### YAML Config

```yaml
providers:
  openai:
    enabled: true
    apiKey: ${OPENAI_API_KEY}
```

---

## Ollama Provider

Import from `botinabox/ollama`. No peer dependency required -- Ollama uses the native `fetch` API.

```typescript
import createOllamaProvider from 'botinabox/ollama';
import { OllamaProvider } from 'botinabox/ollama';

// Default: connects to http://localhost:11434
const provider = createOllamaProvider();

// Or specify a custom URL
const provider2 = createOllamaProvider({
  baseUrl: 'http://gpu-server:11434',
});
```

### Dynamic Model Discovery

Ollama does not ship a static model list. Instead, it queries the Ollama server's `/api/tags` endpoint to discover which models are pulled locally. The model list is cached for 5 minutes.

```typescript
// Explicitly refresh the model list
const models = await provider.getModels();
// => [{ id: 'llama3:latest', displayName: 'llama3:latest', ... }, ...]
```

Discovered models are assigned default values:
- `contextWindow`: 128,000
- `maxOutputTokens`: 4,096
- `capabilities`: `['chat', 'streaming']`

### Chat

```typescript
const result = await provider.chat({
  model: 'llama3:latest',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
  system: 'Answer concisely.',
  maxTokens: 100,
  temperature: 0.1,
});
```

### Streaming

```typescript
const stream = provider.chatStream({
  model: 'llama3:latest',
  messages: [{ role: 'user', content: 'Write a limerick.' }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

### YAML Config

```yaml
providers:
  ollama:
    enabled: true
    baseUrl: http://localhost:11434
```

---

## Cost Tracking

The `setupCostTracker` function listens for `run.completed` hook events and records token usage and cost in the `cost_events` database table. It also updates per-agent monthly spend.

```typescript
import { setupCostTracker } from 'botinabox';
import type { HookBus, DataStore, ModelInfo } from 'botinabox';

// Pass the model catalog so cost can be calculated from token counts
setupCostTracker(hooks, db, {
  modelCatalog: registry.listModels(),
});
```

### How it works

1. When a `run.completed` event fires with `usage` data (containing `inputTokens`, `outputTokens`, `model`, `provider`), the tracker looks up the model in the catalog.
2. Cost is calculated: `(inputTokens / 1M) * inputCostPerMToken + (outputTokens / 1M) * outputCostPerMToken`, rounded to cents.
3. A row is inserted into `cost_events`:

| Column | Type | Description |
|--------|------|-------------|
| `agent_id` | text | Agent that ran the task |
| `run_id` | text | The run that produced this usage |
| `provider` | text | Provider ID (e.g. `anthropic`) |
| `model` | text | Model ID (e.g. `claude-sonnet-4-6`) |
| `input_tokens` | integer | Input token count |
| `output_tokens` | integer | Output token count |
| `cost_cents` | integer | Calculated cost in cents |

4. The agent's `spent_monthly_cents` field is incremented.

### Querying cost data

```typescript
// Get all cost events for an agent
const events = await db.query('cost_events', {
  where: { agent_id: 'my-agent' },
});

// Get an agent's total monthly spend
const agent = await db.get('agents', 'my-agent');
console.log(`Spent this month: ${agent.spent_monthly_cents} cents`);
```

---

## Types Reference

All types are exported from the main `botinabox` package.

```typescript
import type {
  LLMProvider,
  ModelInfo,
  ResolvedModel,
  ChatParams,
  ChatResult,
  ChatMessage,
  ContentBlock,
  TokenUsage,
  ToolDefinition,
  ToolUse,
  ModelConfig,
} from 'botinabox';
```

### ChatMessage

```typescript
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}
```

Content can be a plain string for simple text, or an array of `ContentBlock` for structured content (tool use, tool results).

### ContentBlock

```typescript
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };
```

### ChatParams

```typescript
interface ChatParams {
  messages: ChatMessage[];
  system?: string;              // System prompt
  tools?: ToolDefinition[];     // Available tools
  maxTokens?: number;           // Max output tokens
  temperature?: number;         // Sampling temperature
  model: string;                // Model ID
  abortSignal?: AbortSignal;    // Cancel the request
}
```

### ChatResult

```typescript
interface ChatResult {
  content: string;              // Text response
  toolUses?: ToolUse[];         // Tool calls requested by the model
  usage: TokenUsage;            // Token counts
  model: string;                // Actual model ID used
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}
```

### TokenUsage

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
```

### ToolDefinition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
}
```

### ToolUse

```typescript
interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}
```

### ModelInfo

```typescript
interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Array<'chat' | 'tools' | 'vision' | 'streaming'>;
  inputCostPerMToken?: number;   // Micro-cents per 1M tokens
  outputCostPerMToken?: number;
}
```

### ResolvedModel

```typescript
interface ResolvedModel {
  provider: string;   // Provider ID
  model: string;      // Model ID
}
```

---

## Tool Definition and Tool Use Loop

Tools let the LLM call functions you define. The flow works the same across all providers:

### 1. Define tools

```typescript
import type { ToolDefinition } from 'botinabox';

const tools: ToolDefinition[] = [
  {
    name: 'search_database',
    description: 'Search the product database by query string.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
];
```

### 2. Serialize for the provider

Each provider converts `ToolDefinition[]` to its native format:

```typescript
const nativeTools = provider.serializeTools(tools);
// Anthropic: [{ name, description, input_schema: { type: 'object', ... } }]
// OpenAI:    [{ type: 'function', function: { name, description, parameters } }]
```

You do not need to call `serializeTools` yourself -- the `chat()` method handles it internally. It is exposed for advanced use cases.

### 3. Run the tool loop

A standard tool-use loop calls the LLM, checks if it wants to use a tool, executes the tool, and feeds the result back:

```typescript
import type { ChatMessage, ChatResult, ToolDefinition, ContentBlock } from 'botinabox';

async function runToolLoop(
  provider: LLMProvider,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  executeTool: (name: string, input: unknown) => Promise<string>,
  maxIterations = 20,
): Promise<ChatResult> {
  let iterations = 0;

  while (iterations < maxIterations) {
    const result = await provider.chat({ model, messages, tools });
    iterations++;

    if (result.stopReason !== 'tool_use' || !result.toolUses?.length) {
      return result;
    }

    // Add assistant message with tool use blocks
    const assistantContent: ContentBlock[] = [];
    if (result.content) {
      assistantContent.push({ type: 'text', text: result.content });
    }
    for (const tu of result.toolUses) {
      assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    }
    messages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool and add results
    const toolResults: ContentBlock[] = [];
    for (const tu of result.toolUses) {
      const output = await executeTool(tu.name, tu.input);
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: output });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error(`Tool loop exceeded ${maxIterations} iterations`);
}
```

---

## Building a Custom Provider

Implement the `LLMProvider` interface and export a factory function.

```typescript
import type {
  LLMProvider,
  ChatParams,
  ChatResult,
  ModelInfo,
  ToolDefinition,
} from 'botinabox';

class MyProvider implements LLMProvider {
  readonly id = 'my-provider';
  readonly displayName = 'My Custom LLM';
  readonly models: ModelInfo[] = [
    {
      id: 'my-model-v1',
      displayName: 'My Model v1',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      capabilities: ['chat', 'tools'],
      inputCostPerMToken: 1.0,
      outputCostPerMToken: 3.0,
    },
  ];

  private apiKey: string;

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    // Call your LLM API here
    const response = await fetch('https://api.my-llm.com/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens,
      }),
      signal: params.abortSignal,
    });

    const data = await response.json();

    return {
      content: data.text,
      usage: {
        inputTokens: data.usage.input,
        outputTokens: data.usage.output,
      },
      model: params.model,
      stopReason: 'end_turn',
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<string, ChatResult, unknown> {
    // Implement streaming -- yield text chunks, return final ChatResult
    const result = await this.chat(params);
    yield result.content;
    return result;
  }

  serializeTools(tools: ToolDefinition[]): unknown {
    // Convert ToolDefinition[] to your API's native tool format
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      schema: t.parameters,
    }));
  }
}

// Default export for factory pattern
export default function createMyProvider(config: { apiKey: string }): LLMProvider {
  return new MyProvider(config);
}
```

Register your custom provider the same way as built-in ones:

```typescript
import createMyProvider from './my-provider.js';

registry.register(createMyProvider({ apiKey: 'sk-...' }));
```
