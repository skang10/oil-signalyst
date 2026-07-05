import type { TagKind } from '@/components/shared/TagBadge';

// Feature category -> badge color, shared by Data Monitor and the Signals
// page's Feature Pool so the same category always reads the same color.
// Unknown categories (and the '—' placeholder on removed-feature ghost rows)
// fall back to 'muted' at the call site.
export const CATEGORY_TAG: Record<string, TagKind> = {
  'Futures Curve': 'blue',
  Inventory: 'green',
  Positioning: 'purple',
  Volatility: 'yellow',
  'Price Momentum': 'blue',
  'Cross-Asset': 'purple',
  Macro: 'muted',
};
