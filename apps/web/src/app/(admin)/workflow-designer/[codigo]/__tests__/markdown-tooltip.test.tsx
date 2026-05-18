import { describe, it, expect } from "vitest";
import { hasMarkdownContent } from "../_components/workflow-graph";

describe("hasMarkdownContent", () => {
  it("returns false for null / undefined / empty / whitespace strings", () => {
    expect(hasMarkdownContent(null)).toBe(false);
    expect(hasMarkdownContent(undefined)).toBe(false);
    expect(hasMarkdownContent("")).toBe(false);
    expect(hasMarkdownContent("   \n\t  ")).toBe(false);
  });

  it("returns true for any string with renderable content", () => {
    expect(hasMarkdownContent("Hola")).toBe(true);
    expect(hasMarkdownContent("**negrita**")).toBe(true);
    expect(hasMarkdownContent("- item 1\n- item 2")).toBe(true);
    expect(hasMarkdownContent("# Heading\n\nParrafo")).toBe(true);
  });

  it("trims whitespace before evaluating — espacios al borde no cuentan", () => {
    expect(hasMarkdownContent("\n\n   texto   \n")).toBe(true);
    expect(hasMarkdownContent("  \r\n  \t  ")).toBe(false);
  });
});
