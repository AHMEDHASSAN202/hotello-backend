/**
 * Story 6.3 AC5 — templates are typed TS functions: a missing variable is a
 * compile error at call sites and a loud runtime error via `requiredVars`
 * when rendering from stored (jsonb) variables.
 */
export interface LocalizedTemplate<V> {
  subject(vars: V): string;
  content(vars: V): string;
}

export interface NotificationTemplate<V> {
  /** Runtime guard for renders from stored variables (resend path). */
  requiredVars: readonly (keyof V & string)[];
  ar: LocalizedTemplate<V>;
  en: LocalizedTemplate<V>;
}
