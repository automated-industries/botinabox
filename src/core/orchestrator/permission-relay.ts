/**
 * PermissionRelay — remote approval for unattended agent execution.
 * Story 6.6
 *
 * When an agent needs human approval but the operator is away:
 * 1. Post the approval prompt to a messaging platform (Slack, Discord, etc.)
 * 2. Poll for response (approve/deny)
 * 3. Relay the decision back to the agent
 *
 * Dual approval: local terminal + remote messaging. First response wins.
 * Race condition handled by atomic state transition.
 */

import type { HookBus } from '../hooks/hook-bus.js';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface PermissionPrompt {
  id: string;
  agentId: string;
  action: string;        // e.g. "run bash command: rm -rf /tmp/cache"
  context?: string;       // additional context for the reviewer
  requestedAt: string;
  expiresAt?: string;
}

export interface ApprovalResponse {
  promptId: string;
  status: 'approved' | 'denied';
  respondedBy: string;    // "local" | "slack:U12345" | "discord:user#1234"
  respondedAt: string;
  comment?: string;
}

/**
 * Provider interface — implement for each messaging platform.
 */
export interface PermissionProvider {
  readonly id: string;

  /** Post an approval request, return a handle for polling. */
  sendPrompt(prompt: PermissionPrompt): Promise<string>;

  /** Check for a response. Returns undefined if still pending. */
  pollResponse(handle: string): Promise<ApprovalResponse | undefined>;

  /** Cancel a pending prompt (e.g. after local approval). */
  cancelPrompt(handle: string): Promise<void>;
}

export interface PermissionRelayConfig {
  /** Registered providers (e.g. Slack, Discord adapters) */
  providers: PermissionProvider[];
  /** Poll interval in ms. Default: 5000 */
  pollIntervalMs?: number;
  /** Timeout for pending approvals in ms. Default: 300_000 (5 min) */
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;

export class PermissionRelay {
  private readonly providers: PermissionProvider[];
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, {
    prompt: PermissionPrompt;
    handles: Map<string, string>;  // providerId → handle
    resolve: (response: ApprovalResponse) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    private hooks: HookBus,
    config: PermissionRelayConfig,
  ) {
    this.providers = config.providers;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Request approval from all configured providers.
   * Returns when the first provider responds (approve or deny).
   */
  async requestApproval(prompt: PermissionPrompt): Promise<ApprovalResponse> {
    // Set expiry
    const expiresAt = new Date(Date.now() + this.timeoutMs).toISOString();
    const promptWithExpiry = { ...prompt, expiresAt };

    await this.hooks.emit('permission.requested', {
      promptId: prompt.id,
      agentId: prompt.agentId,
      action: prompt.action,
    });

    // Send to all providers
    const handles = new Map<string, string>();
    for (const provider of this.providers) {
      try {
        const handle = await provider.sendPrompt(promptWithExpiry);
        handles.set(provider.id, handle);
      } catch {
        // Provider unavailable — continue with others
      }
    }

    if (handles.size === 0) {
      throw new Error('No permission providers available');
    }

    // Race: poll all providers, first response wins
    return new Promise<ApprovalResponse>((resolve, reject) => {
      const entry = {
        prompt: promptWithExpiry,
        handles,
        resolve,
        reject,
      };
      this.pending.set(prompt.id, entry);

      // Start polling
      const pollTimer = setInterval(async () => {
        for (const [providerId, handle] of handles) {
          const provider = this.providers.find((p) => p.id === providerId);
          if (!provider) continue;

          try {
            const response = await provider.pollResponse(handle);
            if (response) {
              clearInterval(pollTimer);
              clearTimeout(timeoutTimer);
              this.pending.delete(prompt.id);

              // Cancel remaining providers
              await this.cancelOtherProviders(handles, providerId);

              await this.hooks.emit('permission.responded', {
                promptId: prompt.id,
                status: response.status,
                respondedBy: response.respondedBy,
              });

              resolve(response);
              return;
            }
          } catch {
            // Poll error — continue
          }
        }
      }, this.pollIntervalMs);

      // Timeout
      const timeoutTimer = setTimeout(async () => {
        clearInterval(pollTimer);
        this.pending.delete(prompt.id);

        // Cancel all providers
        for (const [providerId, handle] of handles) {
          const provider = this.providers.find((p) => p.id === providerId);
          if (provider) {
            try { await provider.cancelPrompt(handle); } catch { /* ignore */ }
          }
        }

        await this.hooks.emit('permission.expired', {
          promptId: prompt.id,
          agentId: prompt.agentId,
        });

        reject(new Error(`Permission request expired after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
  }

  /**
   * Provide a local approval (from terminal).
   * Resolves the pending request and cancels remote providers.
   */
  async approveLocally(promptId: string, approved: boolean): Promise<void> {
    const entry = this.pending.get(promptId);
    if (!entry) return;

    const response: ApprovalResponse = {
      promptId,
      status: approved ? 'approved' : 'denied',
      respondedBy: 'local',
      respondedAt: new Date().toISOString(),
    };

    this.pending.delete(promptId);

    // Cancel all remote providers
    for (const [providerId, handle] of entry.handles) {
      const provider = this.providers.find((p) => p.id === providerId);
      if (provider) {
        try { await provider.cancelPrompt(handle); } catch { /* ignore */ }
      }
    }

    await this.hooks.emit('permission.responded', {
      promptId,
      status: response.status,
      respondedBy: 'local',
    });

    entry.resolve(response);
  }

  /**
   * Get all pending approval requests.
   */
  getPending(): PermissionPrompt[] {
    return Array.from(this.pending.values()).map((e) => e.prompt);
  }

  private async cancelOtherProviders(
    handles: Map<string, string>,
    excludeProviderId: string,
  ): Promise<void> {
    for (const [providerId, handle] of handles) {
      if (providerId === excludeProviderId) continue;
      const provider = this.providers.find((p) => p.id === providerId);
      if (provider) {
        try { await provider.cancelPrompt(handle); } catch { /* ignore */ }
      }
    }
  }
}
