/**
 * Rendering for numbers the backend deliberately withheld.
 *
 * When a constant baseline is serving in place of a trained model, the decision
 * engine returns null for hedge ratio, CVaR and Kelly rather than a number (see
 * core/postprocess/decision_engine.py). Those fields are abstentions, not zeros:
 * a 0% hedge ratio is itself a recommendation, and rendering `null * 100` as
 * "0.0%" would turn "we are not advising" into "we advise nothing" - the two
 * look identical on screen and mean opposite things.
 *
 * Everything that displays one of those fields goes through here so the
 * distinction cannot be lost by an accidental arithmetic coercion.
 */

/** Em dash - the house style for "no value", matching fmt() in model-metrics. */
export const ABSTAINED = '—';

export function isAbstained(value: number | null | undefined): boolean {
  return value === null || value === undefined;
}

/** A 0-1 ratio as a whole percentage, or the abstention dash. */
export function pctOrAbstain(value: number | null | undefined, digits = 0): string {
  return isAbstained(value) ? ABSTAINED : `${(value! * 100).toFixed(digits)}%`;
}

/** A plain number with an optional unit suffix, or the abstention dash. */
export function numOrAbstain(
  value: number | null | undefined,
  digits = 1,
  unit = ''
): string {
  return isAbstained(value) ? ABSTAINED : `${value!.toFixed(digits)}${unit}`;
}
