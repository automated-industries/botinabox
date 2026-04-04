/**
 * Minimal HTTP server for webhook inbound messages.
 * Story 4.7
 */

import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { InboundMessage } from "../../shared/index.js";
import { verifyHmac } from "./hmac.js";

export interface WebhookServerOpts {
  port?: number;
  secret?: string;
  onMessage: (msg: InboundMessage) => Promise<void>;
}

export class WebhookServer {
  private server: Server | null = null;
  private readonly port: number;
  private readonly secret: string | undefined;
  private readonly onMessage: (msg: InboundMessage) => Promise<void>;

  constructor(opts: WebhookServerOpts) {
    this.port = opts.port ?? 3200;
    this.secret = opts.secret;
    this.onMessage = opts.onMessage;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.listen(this.port, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method !== "POST" || url !== "/webhook/inbound") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Read body
    let body = "";
    for await (const chunk of req) {
      body += chunk as string;
    }

    // Verify HMAC if secret is configured
    if (this.secret) {
      const sig = req.headers["x-webhook-signature"] as string | undefined;
      if (!sig || !verifyHmac(body, this.secret, sig)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    // Build InboundMessage from payload
    const msg: InboundMessage = {
      id: (parsed["id"] as string) ?? `webhook-${Date.now()}`,
      channel: "webhook",
      from: (parsed["from"] as string) ?? "unknown",
      body: (parsed["text"] as string) ?? "",
      threadId: parsed["threadId"] as string | undefined,
      receivedAt: new Date().toISOString(),
      raw: parsed,
    };

    try {
      await this.onMessage(msg);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error('[webhook] Error:', err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
}
