import * as fs from 'node:fs';
import * as path from 'node:path';

export class Manifest {
  private data: Record<string, string[]> = {};

  constructor(private readonly manifestPath: string) {}

  load(): Record<string, string[]> {
    try {
      const content = fs.readFileSync(this.manifestPath, 'utf-8');
      this.data = JSON.parse(content) as Record<string, string[]>;
    } catch {
      this.data = {};
    }
    return this.data;
  }

  save(manifest: Record<string, string[]>): void {
    const dir = path.dirname(this.manifestPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    this.data = manifest;
  }

  getFiles(key: string): string[] {
    return this.data[key] ?? [];
  }

  setFiles(key: string, files: string[]): void {
    this.data[key] = files;
  }

  cleanup(key: string, currentFiles: string[], protectedFiles: string[]): void {
    const existing = this.data[key] ?? [];
    const currentSet = new Set(currentFiles);
    const protectedSet = new Set(protectedFiles);

    for (const file of existing) {
      if (!currentSet.has(file) && !protectedSet.has(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // Ignore if file doesn't exist
        }
      }
    }

    // Update manifest to only contain current files
    this.data[key] = currentFiles;
  }
}
