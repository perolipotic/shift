import {
  REQUEST_PENDING,
  organizationLeaveRequestsOf,
  type ReviewedLeaveRequest,
} from '@/features/leave/services/leave-request-list';
import { DEACTIVATE, type REACTIVATE } from '@/features/members/services/wire';
import { RANGE_DASH, formatIsoDate, formatList, isIsoDate } from '@/lib/i18n/format';

/**
 * Retro 8–9, C1 + C4: the member's pending leave requests a deactivation from
 * `day` closes (0041's trigger), for the status dialog's question. A request
 * is closed WHOLE when its range reaches `day` or later — its last date on or
 * after `day` — and one that ended before `day` stays pending. The database
 * decides; this only names what it will do.
 *
 * `null` — the dialog then names no request — for a reactivation, a date that
 * is not one or lies before the offer's minimum, a read not answered yet
 * (`rows` null), or a read that cannot be trusted. NEVER A GATE: a missing
 * line never stops the save. An empty list is a member with no such request.
 */
export function deactivationClosedRequestsOf(
  rows: readonly unknown[] | null,
  memberId: string,
  offer: { readonly change: typeof DEACTIVATE | typeof REACTIVATE; readonly minimum: string } | null,
  day: string,
): readonly ReviewedLeaveRequest[] | null {
  if (rows === null || offer === null || offer.change !== DEACTIVATE || !isIsoDate(day) || day < offer.minimum) {
    return null;
  }

  const requests = organizationLeaveRequestsOf(rows);

  if (requests === null) return null;

  return requests.filter(
    (request) => request.memberId === memberId && request.status === REQUEST_PENDING && request.to >= day,
  );
}

/**
 * The requests as the question names them: `03.11.2026–07.11.2026`, each
 * range in the binding shape, joined as a Croatian sentence lists them.
 */
export function deactivationClosedRangesText(requests: readonly ReviewedLeaveRequest[]): string {
  return formatList(
    requests.map((request) => `${formatIsoDate(request.from) ?? request.from}${RANGE_DASH}${formatIsoDate(request.to) ?? request.to}`),
  );
}
