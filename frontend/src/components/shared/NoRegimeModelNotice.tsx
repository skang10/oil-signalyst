/**
 * Shown wherever a regime call would go when no regime model is deployed.
 *
 * Regime is a frozen state descriptor, not a forecast: it has no observable
 * outcome to be scored against, so it is not retrainable and has no baseline to
 * fall back on the way eia and returns do. A fresh system therefore legitimately
 * has none, and the honest rendering is to say so - the report's `dominant`
 * field still carries a fallback value, and drawing it as a regime call at 0%
 * confidence would invent a reading the system does not have.
 */
export default function NoRegimeModelNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="text-[11px] text-text-muted">
        No regime model deployed — regime probabilities unavailable.
      </div>
    );
  }
  return (
    <div className="p-[14px] rounded-default border border-border bg-surface-1">
      <div className="text-[12px] font-medium mb-[4px]">No regime model deployed</div>
      <div className="text-[11.5px] text-text-muted">
        Regime describes the current market state rather than forecasting an outcome, so there is
        nothing to train or score it against — and unlike the EIA and returns models it has no
        baseline to fall back on. Directional signals are held FLAT while it is missing. The EIA and
        returns forecasts are unaffected.
      </div>
    </div>
  );
}
