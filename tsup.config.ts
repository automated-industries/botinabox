import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'providers/anthropic/index': 'src/providers/anthropic/index.ts',
    'providers/openai/index': 'src/providers/openai/index.ts',
    'providers/ollama/index': 'src/providers/ollama/index.ts',
    'channels/slack/index': 'src/channels/slack/index.ts',
    'channels/discord/index': 'src/channels/discord/index.ts',
    'channels/webhook/index': 'src/channels/webhook/index.ts',
    'connectors/google/index': 'src/connectors/google/index.ts',
    'cli': 'src/cli.ts',
  },
  format: ['esm'],
  dts: false, // declarations generated separately via tsc --emitDeclarationOnly
  target: 'es2022',
});
