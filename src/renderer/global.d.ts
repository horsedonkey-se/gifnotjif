// The renderer scripts are plain classic scripts with no module system, so
// what the preloads expose has to be declared on `window` here.

import type { HudBridge, OverlayBridge } from '../main/types';

declare global {
  interface Window {
    overlay: OverlayBridge;
    hud: HudBridge;
  }

  // A classic script cannot import, so any type its code names has to be
  // global. This one is aliased rather than redefined, so the two ends of the
  // channel still cannot drift apart.
  type PickableWindow = import('../main/types').PickableWindow;
}

export {};
