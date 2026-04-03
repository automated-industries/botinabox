export function envTemplate(channel?: string, provider?: string): string {
  const lines: string[] = [
    '# Bot environment variables',
    '# Copy this file to .env and fill in the values',
    '',
  ];

  if (provider === 'anthropic' || !provider) {
    lines.push('ANTHROPIC_API_KEY=your_anthropic_api_key_here');
  } else if (provider === 'openai') {
    lines.push('OPENAI_API_KEY=your_openai_api_key_here');
  } else {
    lines.push(`${provider.toUpperCase()}_API_KEY=your_api_key_here`);
  }

  lines.push('');

  if (channel === 'slack' || !channel) {
    lines.push('SLACK_BOT_TOKEN=xoxb-your-slack-bot-token');
    lines.push('SLACK_APP_TOKEN=xapp-your-slack-app-token');
    lines.push('SLACK_SIGNING_SECRET=your_slack_signing_secret');
  } else if (channel === 'discord') {
    lines.push('DISCORD_BOT_TOKEN=your_discord_bot_token');
  } else {
    lines.push(`${channel.toUpperCase()}_TOKEN=your_token_here`);
  }

  lines.push('');

  return lines.join('\n');
}
