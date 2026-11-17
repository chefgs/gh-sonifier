/**
 * Just enough of the extension API to typecheck what this project actually calls.
 * Declared locally so the build has no dependency on a types package.
 */

interface ChromeMessageSender {
  id?: string;
  origin?: string;
  url?: string;
  tab?: { id?: number };
}

interface ChromeEvent<T extends (...args: never[]) => unknown> {
  addListener(callback: T): void;
  removeListener(callback: T): void;
}

declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: ChromeEvent<
      (message: unknown, sender: ChromeMessageSender, respond: (response: unknown) => void) => boolean | undefined
    >;
    onInstalled: ChromeEvent<(details: { reason: string }) => void>;
    lastError?: { message?: string };
  };
  action: {
    onClicked: ChromeEvent<(tab: { id?: number }) => void>;
  };
  tabs: {
    create(options: { url: string }): Promise<{ id?: number }>;
  };
};
