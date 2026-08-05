import { contextBridge, ipcRenderer } from 'electron';

import type { OverlayBridge, PickableWindow, Region } from './types';

const overlay: OverlayBridge = {
  confirm: (rect: Region) => ipcRenderer.send('overlay:confirm', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  onWindows: (fn) => {
    ipcRenderer.on('overlay:windows', (_event, windows: PickableWindow[]) => fn(windows));
  },
};

contextBridge.exposeInMainWorld('overlay', overlay);
