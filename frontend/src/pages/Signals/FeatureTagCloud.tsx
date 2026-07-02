import type { SignalsResponse } from '@/types/api';
import TagBadge, { type TagKind } from '@/components/shared/TagBadge';

const CATEGORY_TAG: Record<SignalsResponse['active'][number]['category'], TagKind> = {
  'Futures Curve': 'blue',
  Inventory: 'green',
  Positioning: 'purple',
  Volatility: 'yellow',
  Macro: 'muted',
};

export default function FeatureTagCloud({ features }: { features: SignalsResponse['active'] }) {
  return (
    <div className="flex flex-wrap gap-[6px]">
      {features.map((f) => (
        <TagBadge key={f.name} kind={CATEGORY_TAG[f.category]}>
          ✓ {f.name}
        </TagBadge>
      ))}
    </div>
  );
}
