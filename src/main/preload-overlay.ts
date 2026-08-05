import { contextBridge, ipcRenderer } from 'electron';

import type { OverlayBridge, Region } from './types';

const overlay: OverlayBridge = {
  confirm: (rect: Region) => ipcRenderer.send('overlay:confirm', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
};

contextBridge.exposeInMainWorld('overlay', overlay);
