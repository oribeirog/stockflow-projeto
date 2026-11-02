import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
export function isTrustedRequest(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  allowedUrl: string,
  args: unknown[],
  expectedArguments = 0,
): boolean {
  return isTrustedSender(event, window, allowedUrl) && args.length === expectedArguments;
}
export function isTrustedSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  allowedUrl: string,
): boolean {
  return (
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame?.url.split('#')[0] === allowedUrl
  );
}
