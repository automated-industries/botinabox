/**
 * Slack filetype → AttachmentMediaType mapping.
 *
 * Extensible: add new entries to FILETYPE_MAP to support new formats.
 * The categories align with observation media_type values used elsewhere
 * in the broader platform.
 */

import type { AttachmentMediaType } from "../../shared/types/channel.js";

const FILETYPE_MAP: Record<string, AttachmentMediaType> = {
  // image
  jpg: "image", jpeg: "image", png: "image", gif: "image",
  webp: "image", heic: "image", svg: "image", bmp: "image",

  // video
  mp4: "video", mov: "video", webm: "video", avi: "video", mkv: "video",

  // audio (also handled by voice-message path — included for completeness)
  aac: "audio", m4a: "audio", mp3: "audio", wav: "audio", ogg: "audio", flac: "audio",

  // pdf
  pdf: "pdf",

  // doc
  gdoc: "doc", docx: "doc", doc: "doc", md: "doc", txt: "doc", rtf: "doc",

  // excel
  gsheet: "excel", xlsx: "excel", xls: "excel", csv: "excel", tsv: "excel",

  // presentation
  gslide: "presentation", pptx: "presentation", ppt: "presentation", key: "presentation",

  // html
  html: "html", htm: "html",
};

/**
 * Map a Slack `filetype` string to an AttachmentMediaType category.
 * Unknown types fall through to `"misc"`.
 */
export function slackFiletypeToMediaType(filetype: string | undefined): AttachmentMediaType {
  if (!filetype) return "misc";
  return FILETYPE_MAP[filetype.toLowerCase()] ?? "misc";
}

/**
 * Extract URLs from a plain-text message body.
 * Used to surface inline webpage links as `"link"` attachments.
 * Matches http:// and https:// URLs only.
 */
const URL_REGEX = /https?:\/\/[^\s<>"')]+/g;

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  // Dedupe while preserving order
  return Array.from(new Set(matches.map(u => u.replace(/[.,;:!?)]+$/, ""))));
}
