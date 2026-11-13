import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { IPC_CHANNELS } from "@shared/ipc-channels";

/** Cauce's own repository. */
export const REPO_URL = "https://github.com/reflectstudio-ar/cauce";
/** The upstream project this app is a fork of (MIT). */
export const UPSTREAM_URL = "https://github.com/Gentleman-Programming/gentle-shell-desktop";

export interface MenuContext {
  /** Injected in tests; defaults to process.platform. */
  readonly platform?: NodeJS.Platform;
  /** Injected in tests; defaults to the app's own name. */
  readonly appName?: string;
}

/**
 * The application menu. "New Chat" (Cmd/Ctrl+N) is the only item that talks
 * to the renderer: it forwards a MENU_NEW_CHAT push so App.tsx reuses the
 * same handler as the sidebar button instead of opening a second code path.
 * Everything else is a role or an external link.
 */
export function buildMenuTemplate(window: BrowserWindow, context: MenuContext = {}): MenuItemConstructorOptions[] {
  const platform = context.platform ?? process.platform;
  const appName = context.appName ?? app.name;
  const isMac = platform === "darwin";

  const fileMenu: MenuItemConstructorOptions[] = [
    {
      label: "New Chat",
      accelerator: "CmdOrCtrl+N",
      click: () => window.webContents.send(IPC_CHANNELS.MENU_NEW_CHAT),
    },
    { type: "separator" },
    isMac ? { role: "close" } : { role: "quit" },
  ];

  const editMenu: MenuItemConstructorOptions[] = [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
  ];

  const viewMenu: MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  const windowMenu: MenuItemConstructorOptions[] = [
    { role: "minimize" },
    { role: "zoom" },
    ...(isMac ? [{ type: "separator" as const }, { role: "front" as const }] : []),
  ];

  const helpMenu: MenuItemConstructorOptions[] = [
    { label: `Cauce on GitHub`, click: () => void shell.openExternal(REPO_URL) },
    { label: "Gentle Shell (upstream)", click: () => void shell.openExternal(UPSTREAM_URL) },
    ...(isMac ? [] : [{ type: "separator" as const }, { role: "about" as const, label: `About ${appName}` }]),
  ];

  return [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: "about", label: `About ${appName}` },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", label: `Quit ${appName}` },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    { label: "File", submenu: fileMenu },
    { label: "Edit", submenu: editMenu },
    { label: "View", submenu: viewMenu },
    { label: "Window", submenu: windowMenu },
    { label: "Help", submenu: helpMenu },
  ];
}

/** Builds the menu and makes it the application menu (macOS menubar and
 * Windows/Linux window menu alike). */
export function installAppMenu(window: BrowserWindow, context: MenuContext = {}): Menu {
  const menu = Menu.buildFromTemplate(buildMenuTemplate(window, context));
  Menu.setApplicationMenu(menu);
  return menu;
}
