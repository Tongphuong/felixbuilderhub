/// <reference types="astro/client" />

import type { RankLadderView } from './lib/rank-ladder-ui';

declare global {
  interface Window {
    __r2lV3?: {
      isEnabled: () => boolean;
      applyHeaderRank: (state: Record<string, unknown>, root?: ParentNode) => void;
      showRankUp: (
        rankUp:
          | { changed: boolean; from_label: string; to_label: string; tier_changed: boolean }
          | null
          | undefined,
        ladder?: RankLadderView,
      ) => void;
    };
  }
}

export {};
