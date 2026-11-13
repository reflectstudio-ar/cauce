import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";

const { send, openExternal } = vi.hoisted(() => ({
  send: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { name: "Cauce" },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: vi.fn(() => ({})), setApplicationMenu: vi.fn() },
  shell: { openExternal },
}));

import { buildMenuTemplate, REPO_URL, UPSTREAM_URL } from "./menu";

const window = { webContents: { send } } as unknown as Parameters<typeof buildMenuTemplate>[0];

function submenuOf(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const item = template.find((candidate) => candidate.label === label);
  expect(item, `menu "${label}"`).toBeDefined();
  return item?.submenu as MenuItemConstructorOptions[];
}

function itemOf(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const item = items.find((candidate) => candidate.label === label);
  expect(item, `item "${label}"`).toBeDefined();
  return item as MenuItemConstructorOptions;
}

describe("buildMenuTemplate", () => {
  it("puts New Chat under File with Cmd/Ctrl+N and forwards it to the renderer", () => {
    const template = buildMenuTemplate(window, { platform: "darwin", appName: "Cauce" });

    const newChat = itemOf(submenuOf(template, "File"), "New Chat");
    expect(newChat.accelerator).toBe("CmdOrCtrl+N");

    (newChat.click as () => void)();
    expect(send).toHaveBeenCalledWith("menu.newChat");
  });

  it("adds the macOS application menu with About and Quit", () => {
    const template = buildMenuTemplate(window, { platform: "darwin", appName: "Cauce" });

    const appMenu = submenuOf(template, "Cauce");
    expect(itemOf(appMenu, "About Cauce").role).toBe("about");
    expect(itemOf(appMenu, "Quit Cauce").role).toBe("quit");
  });

  it("keeps an About item in Help on Windows and Linux, which have no app menu", () => {
    const template = buildMenuTemplate(window, { platform: "win32", appName: "Cauce" });

    expect(template.some((item) => item.label === "Cauce")).toBe(false);
    expect(itemOf(submenuOf(template, "Help"), "About Cauce").role).toBe("about");
  });

  it("links Help to Cauce's repository and to the upstream project", () => {
    const template = buildMenuTemplate(window, { platform: "linux", appName: "Cauce" });
    const help = submenuOf(template, "Help");

    (itemOf(help, "Cauce on GitHub").click as () => void)();
    expect(openExternal).toHaveBeenCalledWith(REPO_URL);

    (itemOf(help, "Gentle Shell (upstream)").click as () => void)();
    expect(openExternal).toHaveBeenCalledWith(UPSTREAM_URL);
  });
});
