import { describe, expect, it } from "vitest";
import { formatRelativeTime, projectName } from "./relativeTime";

const NOW = new Date("2026-11-13T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("describes recent times in minutes, hours and days", () => {
    expect(formatRelativeTime("2026-11-13T11:59:40.000Z", NOW)).toBe("just now");
    expect(formatRelativeTime("2026-11-13T11:55:00.000Z", NOW)).toBe("5m ago");
    expect(formatRelativeTime("2026-11-13T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(formatRelativeTime("2026-11-11T12:00:00.000Z", NOW)).toBe("2d ago");
  });

  it("falls back to the calendar date after a week", () => {
    expect(formatRelativeTime("2026-10-01T12:00:00.000Z", NOW)).toBe("2026-10-01");
  });

  it("returns the input when it is not a date", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("not-a-date");
  });
});

describe("projectName", () => {
  it("uses the last path segment", () => {
    expect(projectName("/Users/dev/pi")).toBe("pi");
    expect(projectName("/Users/dev/pi/")).toBe("pi");
    expect(projectName("C:\\work\\cauce")).toBe("cauce");
  });
});
