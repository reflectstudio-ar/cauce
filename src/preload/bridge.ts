import type {
  ChatState,
  ChatSummary,
  DialogAnswer,
  GentleBridge,
  HomeMode,
  PromptImage,
  PromptResult,
  QueueState,
  SetupStatus,
} from "@shared/bridge-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";

/**
 * The minimal shape of Electron's ipcRenderer this bridge needs, injected
 * so createBridge(ipc) can be unit-tested with a fake ipc instead of the
 * real Electron renderer process (which vitest's Node environment doesn't
 * provide).
 */
export interface RendererIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

/** Implements GentleBridge over ipc.invoke (request/response) and
 * ipc.on/removeListener (state/error pushes). src/preload/index.ts calls
 * this with the real Electron ipcRenderer. */
export function createBridge(ipc: RendererIpc): GentleBridge {
  return {
    listChats: () => ipc.invoke(IPC_CHANNELS.LIST_CHATS) as Promise<ChatSummary[]>,
    openChat: (id: string) => ipc.invoke(IPC_CHANNELS.OPEN_CHAT, id) as Promise<ChatState>,
    newChat: () => ipc.invoke(IPC_CHANNELS.NEW_CHAT) as Promise<ChatState>,
    sendMessage: (text: string, images?: readonly PromptImage[]) =>
      ipc.invoke(IPC_CHANNELS.SEND_MESSAGE, text, images) as Promise<PromptResult>,
    followUp: (text: string, images?: readonly PromptImage[]) =>
      ipc.invoke(IPC_CHANNELS.FOLLOW_UP, text, images) as Promise<PromptResult>,
    clearQueue: () => ipc.invoke(IPC_CHANNELS.CLEAR_QUEUE) as Promise<QueueState>,
    abort: () => ipc.invoke(IPC_CHANNELS.ABORT) as Promise<void>,
    answerDialog: (id: string, answer: DialogAnswer) =>
      ipc.invoke(IPC_CHANNELS.ANSWER_DIALOG, id, answer) as Promise<void>,
    setupStatus: () => ipc.invoke(IPC_CHANNELS.SETUP_STATUS) as Promise<SetupStatus>,
    chooseHome: (mode: HomeMode) => ipc.invoke(IPC_CHANNELS.CHOOSE_HOME, mode) as Promise<void>,

    onState(callback: (state: ChatState) => void): () => void {
      const listener = (_event: unknown, state: unknown): void => callback(state as ChatState);
      ipc.on(IPC_CHANNELS.STATE_PUSH, listener);
      return () => ipc.removeListener(IPC_CHANNELS.STATE_PUSH, listener);
    },

    onError(callback: (message: string) => void): () => void {
      const listener = (_event: unknown, message: unknown): void => callback(message as string);
      ipc.on(IPC_CHANNELS.ERROR_PUSH, listener);
      return () => ipc.removeListener(IPC_CHANNELS.ERROR_PUSH, listener);
    },

    onMenuNewChat(callback: () => void): () => void {
      const listener = (): void => callback();
      ipc.on(IPC_CHANNELS.MENU_NEW_CHAT, listener);
      return () => ipc.removeListener(IPC_CHANNELS.MENU_NEW_CHAT, listener);
    },
  };
}
