/**
 * Cauce (Reflect Studio) design tokens as plain TS values, mirroring
 * tokens.css's light scheme. theme.test.ts pins every key against the
 * committed reflect.json fixture so the CSS, this module and the fixture
 * never drift apart by accident.
 */
export const theme = {
  bg: "#FAF7F2",
  panel: "#F1EBE3",
  raised: "#FFFFFF",
  line: "#E7E1D9",
  lineStrong: "#C8BEB2",
  text: "#0E0E0F",
  text2: "#3D3A36",
  muted: "#5E5954",
  accent: "#047857",
  accentActive: "#065F46",
  blue: "#3B5BDB",
  green: "#047857",
  amber: "#B45309",
  red: "#DC2626",
  purple: "#065F46",
  champagne: "#A16207",
  fontDisplay: '"Space Grotesk", "Segoe UI", system-ui, sans-serif',
  fontBody: '"Inter", "Segoe UI", system-ui, sans-serif',
  fontMono: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
} as const;

export type ThemeToken = keyof typeof theme;
