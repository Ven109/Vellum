import { describe, expect, it } from "vitest";
import { keyboardInset } from "../src/state/mobile.js";

describe("keyboardInset", () => {
  it("is zero without a keyboard", () => {
    expect(keyboardInset(844, 844, 0)).toBe(0);
  });

  it("is the height the keyboard covers", () => {
    expect(keyboardInset(844, 508, 0)).toBe(336);
  });

  it("accounts for the visual viewport scrolling within the page", () => {
    expect(keyboardInset(844, 508, 100)).toBe(236);
  });

  it("ignores small changes such as the browser's toolbars sliding away", () => {
    expect(keyboardInset(844, 810, 0)).toBe(0);
    expect(keyboardInset(844, 850, 0)).toBe(0);
  });
});
