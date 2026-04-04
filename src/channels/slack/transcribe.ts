/**
 * Local voice transcription via whisper-node (whisper.cpp bindings).
 *
 * whisper-node is an optional dependency — if not installed, transcription
 * degrades gracefully (returns null). Requires ffmpeg on the system PATH
 * for audio format conversion.
 *
 * Setup:
 *   npm install whisper-node
 *   npx whisper-node download    # download a model (e.g. base.en)
 *   brew install ffmpeg           # or equivalent for your platform
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { createRequire } from "node:module";

export interface TranscribeOptions {
  /** Whisper model name (default: "base.en"). Run `npx whisper-node download` to get models. */
  modelName?: string;
  /** Language code (default: "auto"). Use "en" for English-only models. */
  language?: string;
}

export interface TranscribeResult {
  /** The full transcribed text */
  text: string;
  /** Individual segments with timestamps */
  segments: Array<{ start: string; end: string; speech: string }>;
}

const TEMP_DIR = join(os.tmpdir(), "botinabox-audio");

/**
 * Transcribe an audio buffer using whisper-node.
 *
 * @param audioBuffer - Raw audio data (any format ffmpeg can decode)
 * @param filename - Original filename (used for temp file extension)
 * @param opts - Transcription options
 * @returns Transcribed text, or null if transcription fails or whisper-node is not installed
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  opts?: TranscribeOptions,
): Promise<string | null> {
  // Lazy-load whisper-node (optional CJS dependency)
  let whisper: (path: string, opts: unknown) => Promise<Array<{ start: string; end: string; speech: string }> | null>;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("whisper-node");
    whisper = mod.whisper ?? mod.default ?? mod;
  } catch {
    console.warn("[botinabox] whisper-node not installed — voice transcription unavailable. Run: npm install whisper-node && npx whisper-node download");
    return null;
  }

  // Check ffmpeg availability
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    console.warn("[botinabox] ffmpeg not found — required for audio conversion. Install: brew install ffmpeg");
    return null;
  }

  const id = randomUUID().slice(0, 8);
  const ext = filename.split(".").pop() ?? "aac";
  mkdirSync(TEMP_DIR, { recursive: true });
  const inputPath = join(TEMP_DIR, `${id}.${ext}`);
  const wavPath = join(TEMP_DIR, `${id}.wav`);

  try {
    // Write audio to temp file
    writeFileSync(inputPath, audioBuffer);

    // Convert to WAV 16kHz mono PCM (required by whisper.cpp)
    execFileSync("ffmpeg", ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath], {
      stdio: "ignore",
      timeout: 30_000,
    });

    // Transcribe
    const segments = await whisper(wavPath, {
      modelName: opts?.modelName ?? "base.en",
      whisperOptions: {
        language: opts?.language ?? "auto",
      },
    });

    if (!segments || segments.length === 0) return null;

    return segments.map((s) => s.speech).join(" ").trim();
  } catch (err) {
    console.error("[botinabox] Transcription failed:", err);
    return null;
  } finally {
    // Clean up temp files
    try { unlinkSync(inputPath); } catch { /* ignore */ }
    try { unlinkSync(wavPath); } catch { /* ignore */ }
  }
}

/**
 * Download an audio file from a URL with bearer token authentication.
 */
export async function downloadAudio(
  url: string,
  token: string,
): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      console.error(`[botinabox] Audio download failed: ${resp.status} ${resp.statusText}`);
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    console.error("[botinabox] Audio download error:", err);
    return null;
  }
}
