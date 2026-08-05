import { contextBridge, ipcRenderer } from 'electron';

import type { HudBridge } from './types';

const hud: HudBridge = {
  stop: () => ipcRenderer.send('hud:stop'),
  discard: () => ipcRenderer.send('hud:discard'),
  onStatus: (fn) => {
    ipcRenderer.on('hud:status', (_event, text: string) => fn(text));
  },
};

contextBridge.exposeInMainWorld('hud', hud);
