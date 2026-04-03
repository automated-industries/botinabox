export function indexTsTemplate(name: string): string {
  return `import { DataStore } from '@botinabox/core';
import { readFileSync } from 'fs';

// Load config
const config = JSON.parse(readFileSync('./config.yml', 'utf-8'));

async function main(): Promise<void> {
  console.log('Starting ${name}...');
  // Initialize your bot here
}

main().catch(console.error);
`;
}

export function indexJsTemplate(name: string): string {
  return `import { DataStore } from '@botinabox/core';
import { readFileSync } from 'fs';

// Load config
const config = JSON.parse(readFileSync('./config.yml', 'utf-8'));

async function main() {
  console.log('Starting ${name}...');
  // Initialize your bot here
}

main().catch(console.error);
`;
}
