import { describe, it, expect, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverProviders } from "../auto-discovery.js";
import type { LLMProvider } from "../types.js";

function makeFakeProvider(id: string): LLMProvider {
  return {
    id,
    displayName: `Provider ${id}`,
    models: [],
    chat: async () => { throw new Error("not implemented"); },
    async *chatStream() { throw new Error("not implemented"); },
    serializeTools: () => [],
  };
}

describe("discoverProviders — Story 2.1", () => {
  it("returns empty array when scope dir does not exist", async () => {
    const result = await discoverProviders("/nonexistent/node_modules");
    expect(result).toEqual([]);
  });

  it("returns empty array when @botinabox scope dir is missing", async () => {
    const dir = join(tmpdir(), `botinabox-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      const result = await discoverProviders(dir);
      expect(result).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips packages without botinabox.type === 'provider'", async () => {
    const nodeModules = join(tmpdir(), `botinabox-test-${Date.now()}`);
    const pkgDir = join(nodeModules, "@botinabox", "some-plugin");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@botinabox/some-plugin", botinabox: { type: "channel" } }),
    );
    try {
      const result = await discoverProviders(nodeModules);
      expect(result).toEqual([]);
    } finally {
      await rm(nodeModules, { recursive: true, force: true });
    }
  });

  it("skips packages with no botinabox field", async () => {
    const nodeModules = join(tmpdir(), `botinabox-test-${Date.now()}`);
    const pkgDir = join(nodeModules, "@botinabox", "bare-pkg");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@botinabox/bare-pkg" }),
    );
    try {
      const result = await discoverProviders(nodeModules);
      expect(result).toEqual([]);
    } finally {
      await rm(nodeModules, { recursive: true, force: true });
    }
  });

  it("discovers provider package via injected importer", async () => {
    const nodeModules = join(tmpdir(), `botinabox-test-${Date.now()}`);
    const pkgDir = join(nodeModules, "@botinabox", "test-provider");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@botinabox/test-provider",
        botinabox: { type: "provider" },
      }),
    );

    const fakeProvider = makeFakeProvider("test-provider");
    const mockImporter = vi.fn().mockResolvedValue({ default: fakeProvider });

    try {
      const result = await discoverProviders(nodeModules, mockImporter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("test-provider");
      expect(mockImporter).toHaveBeenCalledWith("@botinabox/test-provider");
    } finally {
      await rm(nodeModules, { recursive: true, force: true });
    }
  });

  it("discovers provider from non-default export", async () => {
    const nodeModules = join(tmpdir(), `botinabox-test-${Date.now()}`);
    const pkgDir = join(nodeModules, "@botinabox", "test-provider2");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@botinabox/test-provider2",
        botinabox: { type: "provider" },
      }),
    );

    const fakeProvider = makeFakeProvider("test-provider2");
    // Module without default export — provider is the module itself
    const mockImporter = vi.fn().mockResolvedValue(fakeProvider);

    try {
      const result = await discoverProviders(nodeModules, mockImporter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("test-provider2");
    } finally {
      await rm(nodeModules, { recursive: true, force: true });
    }
  });

  it("gracefully skips packages that fail to import", async () => {
    const nodeModules = join(tmpdir(), `botinabox-test-${Date.now()}`);
    const pkgDir = join(nodeModules, "@botinabox", "broken-provider");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@botinabox/broken-provider",
        botinabox: { type: "provider" },
      }),
    );

    const failingImporter = vi.fn().mockRejectedValue(new Error("Module not found"));

    try {
      const result = await discoverProviders(nodeModules, failingImporter);
      expect(result).toEqual([]);
    } finally {
      await rm(nodeModules, { recursive: true, force: true });
    }
  });
});
