import { describe, expect, it } from "vitest";
import { VELLUM_FORMAT_VERSION } from "../src/index.js";

describe("@vellum/core", () => {
  it("exposes the document format version", () => {
    expect(VELLUM_FORMAT_VERSION).toBe(1);
  });
});
