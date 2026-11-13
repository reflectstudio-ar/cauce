import { describe, expect, it } from "vitest";
import reflect from "./reflect.json";
import { theme } from "./theme";

describe("theme", () => {
  it("mirrors the committed Reflect fixture key by key", () => {
    const fixture = reflect.vars as Record<string, string>;

    for (const [key, value] of Object.entries(theme)) {
      expect(fixture[key], `reflect.json is missing "${key}"`).toBe(value);
    }
  });

  it("uses Reflect's emerald for actions, not the brighter brand green", () => {
    // #00C566 is Reflect's brand/icon green; white text on it fails
    // contrast, so buttons and links use emerald-700 (#047857) instead.
    expect(theme.accent).toBe("#047857");
    expect(theme.accent).not.toBe("#00C566");
  });
});
