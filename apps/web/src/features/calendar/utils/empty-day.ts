/**
 * What an empty day or an empty month of a day list says (B449): the member
 * is inactive (`member_status_versions`), or on no team — two different
 * reasons, never one sentence for both (UX-DR20). The month model
 * (`@/features/calendar/utils/month`) decides which is true and declares no
 * key; this module names the words, for *Moj raspored*, a chosen person's
 * days and *Danas*'s week and today card alike.
 */

/** What an empty day says: inactive that day, or on no team (taken off its shift included). */
export function dayEmptyMessageKey(day: { readonly inactive: boolean }): 'kalendar.day.noTeam' | 'kalendar.day.inactive' {
  return day.inactive ? 'kalendar.day.inactive' : 'kalendar.day.noTeam';
}

/**
 * What a month with no day list says, the viewer's or a chosen person's:
 * inactive on every date, or on no team. Exhaustive over both.
 */
export function dayListEmptyMessageKey(
  inactive: boolean,
  ofPerson: boolean,
): 'kalendar.noTeam' | 'kalendar.inactive' | 'kalendar.person.noTeam' | 'kalendar.person.inactive' {
  if (ofPerson) return inactive ? 'kalendar.person.inactive' : 'kalendar.person.noTeam';

  return inactive ? 'kalendar.inactive' : 'kalendar.noTeam';
}
