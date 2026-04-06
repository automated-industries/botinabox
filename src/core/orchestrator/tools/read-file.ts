/**
 * Built-in tool: read_file — reads file contents for the agent.
 * Supports .docx (extracts text from XML), .txt, .md, .json, .csv.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { ToolDefinition, ToolHandler } from '../execution-engine.js';

export const readFileTool: { definition: ToolDefinition; handler: ToolHandler } = {
  definition: {
    name: 'read_file',
    description: 'Read/review the contents of a file. Use this when the user asks about what a document contains, wants you to review a contract, check terms, summarize a report, etc. Supports .docx (Word), .txt, .md, .json, .csv. The file_path is in the Files section of your system context.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file (from system context)' },
      },
      required: ['file_path'],
    },
  },
  handler: async (input, context) => {
    const rawPath = input.file_path as string;
    const filePath = context.resolveFilePath?.(rawPath) ?? rawPath;
    if (!existsSync(filePath)) return `Error: file not found at ${filePath}`;
    try {
      if (filePath.endsWith('.docx')) {
        return extractDocxText(filePath);
      }
      return readFileSync(filePath, 'utf8').slice(0, 8000);
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** Extract plain text from a .docx file (ZIP containing word/document.xml). */
function extractDocxText(filePath: string): string {
  // docx is a ZIP archive — read word/document.xml and strip XML tags
  const data = readFileSync(filePath);
  // Find the PK zip signature and word/document.xml entry
  try {
    // Simple approach: use Node's built-in zlib won't work for zip.
    // Use a minimal ZIP parser — find the document.xml entry.
    const zip = parseZipEntries(data);
    const docEntry = zip.find(e => e.name === 'word/document.xml');
    if (!docEntry) return 'Error: could not find document.xml in docx';
    const xml = docEntry.data.toString('utf8');
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
  } catch {
    return 'Error: could not parse docx file';
  }
}

/** Minimal ZIP parser — extracts entries from a ZIP buffer. */
function parseZipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;

  while (offset < buf.length - 4) {
    // Local file header signature: PK\x03\x04
    if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b ||
        buf[offset + 2] !== 0x03 || buf[offset + 3] !== 0x04) {
      break;
    }

    const compressionMethod = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;

    if (compressionMethod === 0) {
      // Stored (no compression)
      entries.push({ name, data: buf.slice(dataStart, dataStart + compressedSize) });
    } else if (compressionMethod === 8) {
      // Deflated — use zlib
      try {
        const { inflateRawSync } = require('node:zlib');
        const inflated = inflateRawSync(buf.slice(dataStart, dataStart + compressedSize));
        entries.push({ name, data: inflated });
      } catch {
        // Skip unreadable entry
      }
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}
