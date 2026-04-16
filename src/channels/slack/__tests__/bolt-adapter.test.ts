import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (must be declared before the import that triggers them)
// ---------------------------------------------------------------------------

// Capture registered hook handlers so tests can invoke them directly.
const registeredHooks: Record<string, (ctx: Record<string, unknown>) => Promise<void>> = {};

// Spy targets for Slack API calls.
const postMessageSpy = vi.fn().mockResolvedValue({ ok: true, ts: '9999.0001' });
const filesUploadV2Spy = vi.fn().mockResolvedValue({ ok: true });

// Mock boltApp instance returned by `new bolt.App(...)`.
const mockBoltApp = {
  event: vi.fn(),
  client: {
    chat: { postMessage: postMessageSpy },
    filesUploadV2: filesUploadV2Spy,
  },
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@slack/bolt', () => ({
  App: vi.fn(() => mockBoltApp),
}));

vi.mock('../inbound.js', () => ({
  parseSlackEvent: vi.fn(),
  enrichVoiceMessage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------
import { SlackBoltAdapter } from '../bolt-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMockHooks() {
  return {
    register: vi.fn((name: string, handler: (ctx: Record<string, unknown>) => Promise<void>) => {
      registeredHooks[name] = handler;
    }),
    emit: vi.fn(),
  };
}

function makeMockPipeline(channelId: string | null = 'C123456') {
  return {
    resolveChannel: vi.fn().mockResolvedValue(channelId),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SlackBoltAdapter — thread_ts forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear captured handlers so each test starts fresh.
    for (const key of Object.keys(registeredHooks)) {
      delete registeredHooks[key];
    }
  });

  async function startAdapter(channelId: string | null = 'C123456') {
    const hooks = makeMockHooks();
    const pipeline = makeMockPipeline(channelId);
    const adapter = new SlackBoltAdapter({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      hooks: hooks as unknown as import('../../../core/hooks/hook-bus.js').HookBus,
      pipeline: pipeline as unknown as import('../../../core/chat/chat-pipeline.js').ChatPipeline,
    });
    await adapter.start();
    return { adapter, hooks, pipeline };
  }

  // -------------------------------------------------------------------------
  // response.ready
  // -------------------------------------------------------------------------
  describe('response.ready handler', () => {
    it('includes thread_ts when threadId is provided', async () => {
      await startAdapter();
      const handler = registeredHooks['response.ready'];
      expect(handler).toBeDefined();

      await handler({ threadId: '1617000000.000001', text: 'Hello', taskId: undefined });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ thread_ts: '1617000000.000001' }),
      );
    });

    it('omits thread_ts when threadId is absent', async () => {
      await startAdapter();
      const handler = registeredHooks['response.ready'];

      await handler({ threadId: undefined, text: 'Top-level reply', taskId: undefined });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ thread_ts: expect.anything() }),
      );
    });

    it('omits thread_ts when threadId is an empty string', async () => {
      await startAdapter();
      const handler = registeredHooks['response.ready'];

      await handler({ threadId: '', text: 'Top-level reply', taskId: undefined });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ thread_ts: expect.anything() }),
      );
    });

    it('omits thread_ts when threadId looks like a Slack channel id', async () => {
      await startAdapter();
      const handler = registeredHooks['response.ready'];

      await handler({ threadId: 'D01234567AB', text: 'Hello', taskId: undefined });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ thread_ts: expect.anything() }),
      );
    });

    it('omits thread_ts when threadId is a client_msg_id UUID', async () => {
      await startAdapter();
      const handler = registeredHooks['response.ready'];

      await handler({ threadId: 'abc-123-def-456', text: 'Hello', taskId: undefined });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ thread_ts: expect.anything() }),
      );
    });

    it('omits thread_ts when threadId is a number', async () => {
      await startAdapter();
      const handler = registeredHooks['response.ready'];

      await handler({ threadId: 34000000, text: 'Hello', taskId: undefined });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({ thread_ts: expect.anything() }),
      );
    });

    it('does not call postMessage when text is empty', async () => {
      await startAdapter();
      const handler = registeredHooks['response.ready'];

      await handler({ threadId: '1617000000.000001', text: '', taskId: undefined });

      expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('does not call postMessage when channel cannot be resolved', async () => {
      await startAdapter(null);
      const handler = registeredHooks['response.ready'];

      await handler({ threadId: '1617000000.000001', text: 'Hello', taskId: undefined });

      expect(postMessageSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // file.deliver
  // -------------------------------------------------------------------------
  describe('file.deliver handler', () => {
    it('includes thread_ts when threadId is provided', async () => {
      await startAdapter();
      const handler = registeredHooks['file.deliver'];
      expect(handler).toBeDefined();

      // Use import.meta.url as a real file path that existsSync will find.
      const { fileURLToPath } = await import('node:url');
      const realFile = fileURLToPath(import.meta.url);

      await handler({
        filePath: realFile,
        fileName: 'test.ts',
        taskId: 'task-1',
        threadId: '1617000000.000001',
      });

      expect(filesUploadV2Spy).toHaveBeenCalledWith(
        expect.objectContaining({ thread_ts: '1617000000.000001' }),
      );
    });

    it('omits thread_ts when threadId is absent', async () => {
      await startAdapter();
      const handler = registeredHooks['file.deliver'];

      const { fileURLToPath } = await import('node:url');
      const realFile = fileURLToPath(import.meta.url);

      await handler({
        filePath: realFile,
        fileName: 'test.ts',
        taskId: 'task-1',
        threadId: undefined,
      });

      expect(filesUploadV2Spy).toHaveBeenCalledWith(
        expect.not.objectContaining({ thread_ts: expect.anything() }),
      );
    });

    it('does not call filesUploadV2 when channelId cannot be resolved', async () => {
      await startAdapter(null);
      const handler = registeredHooks['file.deliver'];

      await handler({
        filePath: '/some/file.txt',
        fileName: 'file.txt',
        taskId: 'task-1',
        threadId: '1617000000.000001',
      });

      expect(filesUploadV2Spy).not.toHaveBeenCalled();
    });
  });
});
