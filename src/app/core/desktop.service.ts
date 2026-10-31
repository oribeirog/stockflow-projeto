import { Injectable } from '@angular/core';
import type { DesktopApi } from '../../../shared/contracts';
declare global {
  interface Window {
    mnrApi?: DesktopApi;
  }
}
@Injectable({ providedIn: 'root' })
export class DesktopService {
  status() {
    if (!window.mnrApi) return Promise.reject(new Error('Abra pelo aplicativo desktop.'));
    return window.mnrApi.system.getStatus();
  }
}
