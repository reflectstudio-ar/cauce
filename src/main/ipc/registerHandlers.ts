import type { IpcMain, WebContents } from "electron";
import type { DialogAnswer, HomeMode, PromptImage } from "@shared/bridge-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { ChatHost } from "../domain/session/ChatHost";
import type { SetupService } from "../ports";

/**
 * Registers `ipcMain.handle` for every GentleBridge request channel
 * (thin pass-through to ChatHost) and forwards ChatHost's state/error
 * pushes to the renderer via `webContents.send`. Takes `ipc`/`webContents`
 * as parameters (never imports the `ipcMain` value itself) so this file
 * never executes `require("electron")` at module load time — only
 * src/main/index.ts, which genuinely runs inside Electron, does that.
 *
 * Returns an unsubscribe function that stops forwarding state/error
 * pushes for this call's webContents. Request handlers are re-registered
 * on `ipc` every call (`removeHandler` first, since Electron's
 * `ipc.handle` throws "Attempted to register a second handler" for a
 * channel that already has one): M1 has exactly one window at a time, but
 * that window can still close and a new one open later (macOS `activate`,
 * T5 host follow-up), so this must tolerate being called again rather
 * than assuming it only ever runs once for the app's lifetime. `setup`
 * (T5) answers the first-run/home-choice channels; it has no per-window
 * state, so it is exposed the same way for every window instead of also
 * needing an unsubscribe.
 */
export function registerHandlers(host: ChatHost, setup: SetupService, webContents: WebContents, ipc: IpcMain): () => void {
  registerRequestHandler(ipc, IPC_CHANNELS.LIST_CHATS, () => host.listChats());
  registerRequestHandler(ipc, IPC_CHANNELS.OPEN_CHAT, (_event, id: string) => host.openChat(id));
  registerRequestHandler(ipc, IPC_CHANNELS.NEW_CHAT, () => host.newChat());
  registerRequestHandler(ipc, IPC_CHANNELS.RENAME_CHAT, (_event, id: string, name: string) => host.renameChat(id, name));
  registerRequestHandler(ipc, IPC_CHANNELS.DELETE_CHAT, (_event, id: string) => host.deleteChat(id));
  registerRequestHandler(ipc, IPC_CHANNELS.SEND_MESSAGE, (_event, text: string, images?: readonly PromptImage[]) =>
    host.sendMessage(text, images ?? []),
  );
  registerRequestHandler(ipc, IPC_CHANNELS.FOLLOW_UP, (_event, text: string, images?: readonly PromptImage[]) =>
    host.followUp(text, images ?? []),
  );
  registerRequestHandler(ipc, IPC_CHANNELS.CLEAR_QUEUE, () => host.clearQueue());
  registerRequestHandler(ipc, IPC_CHANNELS.MODELS_LIST, () => host.listModels());
  registerRequestHandler(ipc, IPC_CHANNELS.MODEL_SET, (_event, provider: string, modelId: string) =>
    host.setModel(provider, modelId),
  );
  registerRequestHandler(ipc, IPC_CHANNELS.THINKING_LEVELS, () => host.listThinkingLevels());
  registerRequestHandler(ipc, IPC_CHANNELS.THINKING_SET, (_event, level: string) => host.setThinkingLevel(level));
  registerRequestHandler(ipc, IPC_CHANNELS.STATS_REFRESH, () => host.refreshStats());
  registerRequestHandler(ipc, IPC_CHANNELS.SESSION_INFO_REFRESH, () => host.refreshSessionInfo());
  registerRequestHandler(ipc, IPC_CHANNELS.ABORT, () => host.abort());
  registerRequestHandler(ipc, IPC_CHANNELS.ANSWER_DIALOG, (_event, id: string, answer: DialogAnswer) =>
    host.answerDialog(id, answer),
  );
  registerRequestHandler(ipc, IPC_CHANNELS.SETUP_STATUS, () => setup.status());
  registerRequestHandler(ipc, IPC_CHANNELS.CHOOSE_HOME, (_event, mode: HomeMode) => setup.chooseHome(mode));

  const unsubscribeState = host.onState((state) => webContents.send(IPC_CHANNELS.STATE_PUSH, state));
  const unsubscribeError = host.onError((message) => webContents.send(IPC_CHANNELS.ERROR_PUSH, message));

  return () => {
    unsubscribeState();
    unsubscribeError();
  };
}

type IpcHandleListener = Parameters<IpcMain["handle"]>[1];

function registerRequestHandler(ipc: IpcMain, channel: string, listener: IpcHandleListener): void {
  ipc.removeHandler(channel);
  ipc.handle(channel, listener);
}
