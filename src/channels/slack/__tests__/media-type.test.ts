import { describe, it, expect } from "vitest";
import { slackFiletypeToMediaType, extractUrls } from "../media-type.js";

describe("slackFiletypeToMediaType", () => {
  it("maps image filetypes", () => {
    expect(slackFiletypeToMediaType("png")).toBe("image");
    expect(slackFiletypeToMediaType("jpg")).toBe("image");
    expect(slackFiletypeToMediaType("jpeg")).toBe("image");
    expect(slackFiletypeToMediaType("gif")).toBe("image");
  });

  it("maps video filetypes", () => {
    expect(slackFiletypeToMediaType("mp4")).toBe("video");
    expect(slackFiletypeToMediaType("mov")).toBe("video");
  });

  it("maps audio filetypes", () => {
    expect(slackFiletypeToMediaType("mp3")).toBe("audio");
    expect(slackFiletypeToMediaType("wav")).toBe("audio");
    expect(slackFiletypeToMediaType("aac")).toBe("audio");
  });

  it("maps pdf filetype", () => {
    expect(slackFiletypeToMediaType("pdf")).toBe("pdf");
  });

  it("maps doc filetypes", () => {
    expect(slackFiletypeToMediaType("docx")).toBe("doc");
    expect(slackFiletypeToMediaType("doc")).toBe("doc");
    expect(slackFiletypeToMediaType("md")).toBe("doc");
    expect(slackFiletypeToMediaType("txt")).toBe("doc");
  });

  it("maps excel filetypes", () => {
    expect(slackFiletypeToMediaType("xlsx")).toBe("excel");
    expect(slackFiletypeToMediaType("csv")).toBe("excel");
  });

  it("maps presentation filetypes", () => {
    expect(slackFiletypeToMediaType("pptx")).toBe("presentation");
    expect(slackFiletypeToMediaType("ppt")).toBe("presentation");
  });

  it("maps html filetypes", () => {
    expect(slackFiletypeToMediaType("html")).toBe("html");
    expect(slackFiletypeToMediaType("htm")).toBe("html");
  });

  it("returns 'misc' for unknown types", () => {
    expect(slackFiletypeToMediaType("unknown")).toBe("misc");
    expect(slackFiletypeToMediaType("xyz")).toBe("misc");
  });

  it("returns 'misc' for undefined", () => {
    expect(slackFiletypeToMediaType(undefined)).toBe("misc");
  });

  it("is case-insensitive", () => {
    expect(slackFiletypeToMediaType("PDF")).toBe("pdf");
    expect(slackFiletypeToMediaType("XLSX")).toBe("excel");
  });
});

describe("extractUrls", () => {
  it("extracts single URL", () => {
    const urls = extractUrls("Check this out https://example.com");
    expect(urls).toEqual(["https://example.com"]);
  });

  it("extracts multiple URLs", () => {
    const urls = extractUrls("See https://example.com and http://test.com");
    expect(urls).toEqual(["https://example.com", "http://test.com"]);
  });

  it("strips trailing punctuation", () => {
    const urls = extractUrls("Link: https://example.com. Check it!");
    expect(urls).toEqual(["https://example.com"]);
  });

  it("deduplicates URLs while preserving order", () => {
    const urls = extractUrls("https://example.com and https://example.com");
    expect(urls).toEqual(["https://example.com"]);
  });

  it("returns empty array for empty string", () => {
    const urls = extractUrls("");
    expect(urls).toEqual([]);
  });

  it("returns empty array for text with no URLs", () => {
    const urls = extractUrls("This is just plain text with no links");
    expect(urls).toEqual([]);
  });

  it("ignores non-http URLs", () => {
    const urls = extractUrls("mailto:test@example.com and ftp://files.com");
    expect(urls).toEqual([]);
  });

  it("handles trailing punctuation variants", () => {
    const urls = extractUrls("Link https://example.com, another https://test.com; end https://final.com.");
    expect(urls).toEqual(["https://example.com", "https://test.com", "https://final.com"]);
  });
});
