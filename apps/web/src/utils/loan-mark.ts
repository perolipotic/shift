/**
 * STORY 18.5 (UX-DR59): whom a lent member was lent from on a date — their
 * home team's name, or `null` when they have none. The calendar's day detail
 * and the filter bar's Osoba picker carry it, and `@/components/loan-mark`
 * words it (`posuđen iz {tim}`), so both say it in one way.
 */
export interface LentFrom {
  readonly teamName: string | null;
}
