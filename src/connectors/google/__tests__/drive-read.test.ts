import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock googleapis ────────────────────────────────────────────────────

const mockFilesGet = vi.fn();
const mockFilesExport = vi.fn();

const mockDrive = {
  files: {
    get: mockFilesGet,
    export: mockFilesExport,
  },
};

vi.mock('googleapis', () => ({
  google: {
    drive: () => mockDrive,
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import {
  downloadDriveFile,
  exportGoogleDoc,
  readDriveFile,
  type DriveFileBytes,
} from '../drive-read.js';

describe('Drive file read primitives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── downloadDriveFile ──────────────────────────────────────────────

  describe('downloadDriveFile', () => {
    it('should download a binary file and return DriveFileBytes', async () => {
      const testBuffer = Buffer.from('PDF content here');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: '1024',
        },
      });

      mockFilesGet.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await downloadDriveFile(mockDrive, 'file-id-123');

      expect(result).toMatchObject({
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      });
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(mockFilesGet).toHaveBeenCalledTimes(2);
    });

    it('should handle missing filename gracefully', async () => {
      const testBuffer = Buffer.from('content');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          mimeType: 'application/pdf',
          size: '100',
        },
      });

      mockFilesGet.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await downloadDriveFile(mockDrive, 'file-id-123');

      expect(result.filename).toBe('document');
    });

    it('should throw when metadata fetch fails', async () => {
      mockFilesGet.mockRejectedValueOnce(new Error('Metadata fetch failed'));

      await expect(downloadDriveFile(mockDrive, 'file-id-123')).rejects.toThrow('Metadata fetch failed');
    });

    it('should throw when binary download fails', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'file.pdf',
          mimeType: 'application/pdf',
          size: '512',
        },
      });

      mockFilesGet.mockRejectedValueOnce(new Error('Download failed'));

      await expect(downloadDriveFile(mockDrive, 'file-id-123')).rejects.toThrow('Download failed');
    });
  });

  // ── exportGoogleDoc ────────────────────────────────────────────────

  describe('exportGoogleDoc', () => {
    it('should export a Google Doc to docx', async () => {
      const testBuffer = Buffer.from('DOCX content');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDocument',
          mimeType: 'application/vnd.google-apps.document',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await exportGoogleDoc(mockDrive, 'doc-id-456', 'docx');

      expect(result).toMatchObject({
        filename: 'MyDocument.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
    });

    it('should export a Google Sheet to xlsx', async () => {
      const testBuffer = Buffer.from('XLSX content');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MySheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await exportGoogleDoc(mockDrive, 'sheet-id-789', 'xlsx');

      expect(result.filename).toBe('MySheet.xlsx');
      expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });

    it('should export a Google Drawing to png', async () => {
      const testBuffer = Buffer.from('PNG binary');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDrawing',
          mimeType: 'application/vnd.google-apps.drawing',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await exportGoogleDoc(mockDrive, 'draw-id-xyz', 'png');

      expect(result.filename).toBe('MyDrawing.png');
      expect(result.mimeType).toBe('image/png');
    });

    it('should throw when exporting a non-Google-native file', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'file.pdf',
          mimeType: 'application/pdf',
        },
      });

      await expect(exportGoogleDoc(mockDrive, 'pdf-id', 'docx')).rejects.toThrow(
        'Cannot export non-Google-native file',
      );
    });

    it('should handle filename without extension', async () => {
      const testBuffer = Buffer.from('PDF');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDoc',
          mimeType: 'application/vnd.google-apps.document',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await exportGoogleDoc(mockDrive, 'doc-id', 'pdf');

      expect(result.filename).toBe('MyDoc.pdf');
    });

    it('should not double-append extension if already present', async () => {
      const testBuffer = Buffer.from('PDF');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDoc.pdf',
          mimeType: 'application/vnd.google-apps.document',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await exportGoogleDoc(mockDrive, 'doc-id', 'pdf');

      expect(result.filename).toBe('MyDoc.pdf');
    });
  });

  // ── readDriveFile ─────────────────────────────────────────────────

  describe('readDriveFile', () => {
    it('should dispatch a binary PDF file to downloadDriveFile', async () => {
      const testBuffer = Buffer.from('PDF data');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      // First call: metadata fetch in readDriveFile
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: '2048',
        },
      });

      // Second call: metadata fetch in downloadDriveFile
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: '2048',
        },
      });

      // Third call: binary download in downloadDriveFile
      mockFilesGet.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await readDriveFile(mockDrive, 'pdf-id');

      expect(result.filename).toBe('report.pdf');
      expect(result.mimeType).toBe('application/pdf');
    });

    it('should dispatch a Google Doc and export to docx', async () => {
      const testBuffer = Buffer.from('DOCX');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      // First call: metadata fetch in readDriveFile
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDocument',
          mimeType: 'application/vnd.google-apps.document',
          size: '0',
        },
      });

      // Second call: metadata fetch in exportGoogleDoc
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDocument',
          mimeType: 'application/vnd.google-apps.document',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await readDriveFile(mockDrive, 'doc-id');

      expect(result.filename).toBe('MyDocument.docx');
      expect(result.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    });

    it('should dispatch a Google Sheet and export to xlsx', async () => {
      const testBuffer = Buffer.from('XLSX');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MySheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          size: '0',
        },
      });

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MySheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await readDriveFile(mockDrive, 'sheet-id');

      expect(result.filename).toBe('MySheet.xlsx');
    });

    it('should dispatch a Google Slides presentation and export to pptx', async () => {
      const testBuffer = Buffer.from('PPTX');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyPresentation',
          mimeType: 'application/vnd.google-apps.presentation',
          size: '0',
        },
      });

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyPresentation',
          mimeType: 'application/vnd.google-apps.presentation',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await readDriveFile(mockDrive, 'slides-id');

      expect(result.filename).toBe('MyPresentation.pptx');
    });

    it('should dispatch a Google Drawing and export to png', async () => {
      const testBuffer = Buffer.from('PNG');
      const testArrayBuffer = testBuffer.buffer.slice(testBuffer.byteOffset, testBuffer.byteOffset + testBuffer.byteLength);

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDrawing',
          mimeType: 'application/vnd.google-apps.drawing',
          size: '0',
        },
      });

      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyDrawing',
          mimeType: 'application/vnd.google-apps.drawing',
        },
      });

      mockFilesExport.mockResolvedValueOnce({
        data: testArrayBuffer,
      });

      const result = await readDriveFile(mockDrive, 'drawing-id');

      expect(result.filename).toBe('MyDrawing.png');
      expect(result.mimeType).toBe('image/png');
    });

    it('should throw for unsupported Google-native types (Scripts)', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyScript',
          mimeType: 'application/vnd.google-apps.script',
          size: '0',
        },
      });

      await expect(readDriveFile(mockDrive, 'script-id')).rejects.toThrow(
        'Unsupported Google-native type: application/vnd.google-apps.script',
      );
    });

    it('should throw for unsupported Google-native types (Forms)', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: {
          name: 'MyForm',
          mimeType: 'application/vnd.google-apps.form',
          size: '0',
        },
      });

      await expect(readDriveFile(mockDrive, 'form-id')).rejects.toThrow(
        'Unsupported Google-native type: application/vnd.google-apps.form',
      );
    });
  });
});
