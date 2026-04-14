/**
 * Google Drive file read primitives — download or export files to raw bytes.
 *
 * Signature-agnostic primitives that produce `{ buffer, mimeType, filename }`
 * tuples for use in attachment enrichment pipelines and other file consumers.
 */

// ── MIME type constants ────────────────────────────────────────────────

const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';
const GOOGLE_DRAWING = 'application/vnd.google-apps.drawing';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Raw file bytes fetched from Google Drive, plus the metadata needed to
 * decide what to do with them (MIME type → extractor, filename → display).
 */
export interface DriveFileBytes {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  /** Size in bytes as reported by the download response. */
  size: number;
}

/**
 * Supported export target formats for Google-native file types
 * (Docs, Sheets, Slides, Drawings).
 */
export type GoogleDocExportAs = 'docx' | 'xlsx' | 'pptx' | 'png' | 'pdf' | 'txt' | 'csv' | 'html';

const EXPORT_MIME: Record<GoogleDocExportAs, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
};

const EXPORT_EXTENSION: Record<GoogleDocExportAs, string> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  png: 'png',
  pdf: 'pdf',
  txt: 'txt',
  csv: 'csv',
  html: 'html',
};

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Download a binary Drive file as raw bytes.
 *
 * Use this for files uploaded to Drive in their native format (pdf, docx,
 * xlsx, pptx, jpg, png, mp4, etc.) — anything where the Drive `mimeType`
 * is NOT `application/vnd.google-apps.*`.
 *
 * For Google-native formats (Docs, Sheets, Slides, Drawings) use
 * `exportGoogleDoc` instead — `files.get` with `alt: 'media'` fails on
 * those with `fileNotDownloadable`.
 *
 * @param drive - googleapis `drive_v3.Drive` instance (kept as `any` to avoid hard type import)
 * @param fileId - Drive file ID
 * @returns Promise resolving to `DriveFileBytes` with buffer, mimeType, filename, and size
 */
export async function downloadDriveFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drive: any,
  fileId: string,
): Promise<DriveFileBytes> {
  // Fetch metadata first
  const metaRes = await drive.files.get({
    fileId,
    fields: 'name,mimeType,size',
  });

  const { name: filename, mimeType, size } = metaRes.data;

  // Download as binary
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = Buffer.from(response.data as ArrayBuffer);

  return {
    buffer,
    mimeType: mimeType ?? 'application/octet-stream',
    filename: filename ?? 'document',
    size: size ? parseInt(String(size), 10) : buffer.length,
  };
}

/**
 * Export a Google-native document to a downloadable format.
 *
 * The `exportAs` argument picks the target MIME type:
 *   - docx → application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *   - xlsx → application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *   - pptx → application/vnd.openxmlformats-officedocument.presentationml.presentation
 *   - png  → image/png
 *   - pdf  → application/pdf
 *   - txt  → text/plain
 *   - csv  → text/csv  (only valid for spreadsheets)
 *   - html → text/html
 *
 * Throws if the source file is not a Google-native type, or if the
 * requested export is not supported for that type (e.g., csv on a Doc).
 *
 * @param drive - googleapis `drive_v3.Drive` instance
 * @param fileId - Drive file ID
 * @param exportAs - Target export format
 * @returns Promise resolving to `DriveFileBytes` with exported content
 */
export async function exportGoogleDoc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drive: any,
  fileId: string,
  exportAs: GoogleDocExportAs,
): Promise<DriveFileBytes> {
  // Fetch metadata
  const metaRes = await drive.files.get({
    fileId,
    fields: 'name,mimeType',
  });

  const { name: filename, mimeType } = metaRes.data;

  if (!mimeType?.startsWith(GOOGLE_NATIVE_PREFIX)) {
    throw new Error(
      `Cannot export non-Google-native file. mimeType: ${mimeType}. Use downloadDriveFile instead.`,
    );
  }

  // Export to target format
  const targetMimeType = EXPORT_MIME[exportAs];
  const response = await drive.files.export(
    { fileId, mimeType: targetMimeType },
    { responseType: 'arraybuffer' },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = Buffer.from(response.data as ArrayBuffer);

  // Append extension to filename if not already present
  const extension = EXPORT_EXTENSION[exportAs];
  let finalFilename = filename ?? 'document';
  if (!finalFilename.endsWith(`.${extension}`)) {
    finalFilename = `${finalFilename}.${extension}`;
  }

  return {
    buffer,
    mimeType: targetMimeType,
    filename: finalFilename,
    size: buffer.length,
  };
}

/**
 * High-level dispatcher. Fetches file metadata, inspects the mimeType,
 * and picks `downloadDriveFile` (binary) or `exportGoogleDoc` (native)
 * automatically.
 *
 * Google-native → exported format mapping:
 *   - Docs       → docx
 *   - Sheets     → xlsx
 *   - Slides     → pptx
 *   - Drawings   → png
 *   - Scripts    → throws (not supported)
 *   - Forms/Site → throws (not supported)
 *
 * Consumers that want a different export target (e.g., gdoc → pdf for
 * Claude's native PDF reading) should call `exportGoogleDoc` directly.
 *
 * @param drive - googleapis `drive_v3.Drive` instance
 * @param fileId - Drive file ID
 * @returns Promise resolving to `DriveFileBytes` with automatically chosen format
 */
export async function readDriveFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drive: any,
  fileId: string,
): Promise<DriveFileBytes> {
  // Fetch metadata
  const metaRes = await drive.files.get({
    fileId,
    fields: 'name,mimeType,size',
  });

  const { mimeType } = metaRes.data;

  // If it's a Google-native type, export it
  if (mimeType?.startsWith(GOOGLE_NATIVE_PREFIX)) {
    if (mimeType === GOOGLE_DOC) {
      return exportGoogleDoc(drive, fileId, 'docx');
    }
    if (mimeType === GOOGLE_SHEET) {
      return exportGoogleDoc(drive, fileId, 'xlsx');
    }
    if (mimeType === GOOGLE_SLIDES) {
      return exportGoogleDoc(drive, fileId, 'pptx');
    }
    if (mimeType === GOOGLE_DRAWING) {
      return exportGoogleDoc(drive, fileId, 'png');
    }
    // Unsupported Google-native type (Scripts, Forms, Sites, etc.)
    throw new Error(`Unsupported Google-native type: ${mimeType}`);
  }

  // Otherwise, download as binary
  return downloadDriveFile(drive, fileId);
}
