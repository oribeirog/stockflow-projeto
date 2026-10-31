import { contextBridge, ipcRenderer } from 'electron';
import { STATUS_CHANNEL, type DesktopApi } from '../../shared/contracts';
const api: DesktopApi = { system: { getStatus: () => ipcRenderer.invoke(STATUS_CHANNEL) } };
contextBridge.exposeInMainWorld('mnrApi', api);
