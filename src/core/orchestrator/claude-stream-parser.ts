/**
 * Parse Claude CLI NDJSON (stream-json) output into structured results.
 * Used by the CLI execution adapter to extract session info, costs,
 * token usage, and text output from Claude CLI subprocess output.
 */

export interface ParsedStream {
  sessionId: string | null;
  model: string | null;
  costUsd: number | null;
  usage: UsageSummary | null;
  summary: string;
  isError: boolean;
  errorMessage: string | null;
  stopReason: string | null;
}

export interface UsageSummary {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * Parse Claude CLI NDJSON output into a structured result.
 * Handles init, assistant, and result event types.
 */
export function parseClaudeStream(stdout: string): ParsedStream {
  let sessionId: string | null = null;
  let model: string | null = null;
  let costUsd: number | null = null;
  let usage: UsageSummary | null = null;
  let isError = false;
  let errorMessage: string | null = null;
  let stopReason: string | null = null;
  const textBlocks: string[] = [];

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const type = event.type as string;

    if (type === "system" && event.subtype === "init") {
      sessionId = (event.session_id as string) ?? null;
      model = (event.model as string) ?? null;
    }

    if (type === "assistant") {
      const msg = event.message as Record<string, unknown> | undefined;
      const content = msg?.content ?? event.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            textBlocks.push(block.text);
          }
        }
      }
    }

    if (type === "result") {
      isError = !!event.is_error;
      stopReason = (event.stop_reason as string) ?? null;
      costUsd =
        typeof event.total_cost_usd === "number" ? event.total_cost_usd : null;

      const u = event.usage as Record<string, number> | undefined;
      if (u) {
        usage = {
          inputTokens: u.input_tokens ?? 0,
          cachedInputTokens: u.cache_read_input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
        };
      }

      if (isError) {
        errorMessage =
          (event.error as string) ??
          (event.result as string) ??
          "Unknown error";
      }

      const resultContent = event.result;
      if (typeof resultContent === "string" && resultContent) {
        textBlocks.push(resultContent);
      }
    }
  }

  return {
    sessionId,
    model,
    costUsd,
    usage,
    summary: textBlocks.join("\n"),
    isError,
    errorMessage,
    stopReason,
  };
}

/** Check if the run stopped due to max turns. */
export function isMaxTurns(parsed: ParsedStream): boolean {
  return (
    parsed.stopReason === "max_turns" || parsed.stopReason === "tool_use"
  );
}

/** Check if Claude CLI requires login. */
export function isLoginRequired(stdout: string): boolean {
  const patterns = [
    "not logged in",
    "login required",
    "authentication required",
    "please log in",
  ];
  const lower = stdout.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

/** Rewrite local image paths to prevent CLI auto-embedding as vision content. */
export function deactivateLocalImagePaths(prompt: string): string {
  return prompt.replace(
    /(?<=\s|^)(\/[\w./-]+\.(?:png|jpg|jpeg|gif|webp|svg))(?=\s|$)/gi,
    "[image-path:$1]",
  );
}
