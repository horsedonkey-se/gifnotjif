// The renderer scripts are plain classic scripts with no module system, so
// what the preloads expose has to be declared on `window` here.

import type { HudBridge, OverlayBridge } from '../main/types';

declare global {
  interface Window {
    overlay: OverlayBridge;
    hud: HudBridge;
  }
}

export {};
