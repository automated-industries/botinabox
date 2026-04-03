# Contributing

Thanks for your interest in contributing to Bot in a Box.

## Development Setup

```bash
git clone https://github.com/automated-industries/botinabox.git
cd botinabox
pnpm install
pnpm build
```

## Project Structure

This is a pnpm monorepo. Packages are in `packages/`:

- `shared/` — Types and constants (zero dependencies)
- `core/` — Core framework
- `cli/` — CLI scaffolding tool
- `providers/` — LLM provider adapters
- `channels/` — Messaging channel adapters

## Running Tests

```bash
# All packages
pnpm test:run

# Single package
cd packages/core && pnpm test
```

Tests use [Vitest](https://vitest.dev/). Each package has its own `vitest.config.ts`.

## Building

```bash
# All packages
pnpm build

# Single package
cd packages/core && pnpm build
```

Build uses [tsup](https://tsup.egoist.dev/) targeting ESM with declaration files.

## Type Checking

```bash
pnpm typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`"type": "module"`)
- ES2022 target
- No default exports except for provider/channel factory functions

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Add or update tests
4. Run `pnpm test:run` and `pnpm typecheck`
5. Open a pull request

## Adding a Provider

1. Create `packages/providers/your-provider/`
2. Implement the `LLMProvider` interface from `@botinabox/shared`
3. Export a default factory function
4. Add `"botinabox": { "type": "provider" }` to `package.json`
5. Add tests

## Adding a Channel Adapter

1. Create `packages/channels/your-channel/`
2. Implement the `ChannelAdapter` interface from `@botinabox/shared`
3. Export a default factory function
4. Add `"botinabox": { "type": "channel" }` to `package.json`
5. Add tests

## Reporting Issues

Open an issue on GitHub with:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Node.js and pnpm versions
