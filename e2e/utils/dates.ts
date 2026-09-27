/** Date formatting the calendar screen shows, for its page object and its spec alike. */

/** `05.10.` — a date as its row header starts. */
export function dayMonth(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

/** `subota` — a date's weekday, as its row header and its cells' labels name it. */
export function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat('hr', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
