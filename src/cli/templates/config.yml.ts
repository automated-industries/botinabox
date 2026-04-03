export interface ConfigTemplateOptions {
  name: string;
  channel?: string;
  provider?: string;
  typescript?: boolean;
}

export function configYmlTemplate(opts: ConfigTemplateOptions): string {
  const { name, channel = 'slack', provider = 'anthropic' } = opts;

  const channelSection = channel === 'slack'
    ? `  slack:
    enabled: true
    token: \${SLACK_BOT_TOKEN}
    appToken: \${SLACK_APP_TOKEN}
    signingSecret: \${SLACK_SIGNING_SECRET}`
    : channel === 'discord'
    ? `  discord:
    enabled: true
    token: \${DISCORD_BOT_TOKEN}`
    : `  ${channel}:
    enabled: true`;

  const providerSection = provider === 'anthropic'
    ? `  anthropic:
    enabled: true
    apiKey: \${ANTHROPIC_API_KEY}`
    : provider === 'openai'
    ? `  openai:
    enabled: true
    apiKey: \${OPENAI_API_KEY}`
    : `  ${provider}:
    enabled: true`;

  return `name: ${name}
version: "1.0.0"

data:
  path: ./data/bot.db
  walMode: true

channels:
${channelSection}

providers:
${providerSection}

agents: []

models:
  default: claude-3-5-sonnet-20241022
  aliases: {}
  routing: {}
  fallbackChain: []

entities: {}

security: {}

render:
  outputDir: ./generated
  watchIntervalMs: 1000

updates:
  policy: notify
  checkIntervalMs: 3600000

budget:
  warnPercent: 80
`;
}
