import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
export function isTrustedRequest(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  allowedUrl: string,
  args: unknown[],
): boolean {
  return (
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame?.url.split('#')[0] === allowedUrl &&
    args.length === 0
  );
}
