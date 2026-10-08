import type { ReactNode } from 'react';

import { DialogDescription } from '@/components/ui/dialog';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { changeContextOf, type DayDetail } from '@/features/calendar/utils/day-detail';
import { previewMemberNameOf, type ChangePreview, type TypeFact } from '@/features/calendar/utils/change-preview';
import { durationMessageKey, durationValuesOf } from '@/features/hour-bands/services/list';
import { t } from '@/lib/i18n';
import { formatList } from '@/lib/i18n/format';

/** A type as the preview names it: `Noć 19:00–07:00`, the name alone for a type with no times, or no rotation. */
function typeShown(type: TypeFact | null): string {
  if (type === null) return t('kalendar.detail.preview.noType');

  return type.range === null ? type.name : t('kalendar.detail.typeTimes', { name: type.name, range: type.range });
}

/**
 * A change dialog's description (story 7.9), shared by both: the team and the
 * date, and the type the day works now with its times, where it works one —
 * `changeContextOf`'s operands in words.
 */
export function ChangeContextDescription({ detail }: { readonly detail: DayDetail }): ReactNode {
  const { team, date, type } = changeContextOf(detail);

  return (
    <DialogDescription className="tabular-nums">
      {type === null
        ? t('kalendar.detail.title', { team, date })
        : t('kalendar.detail.changeContext', { team, date, type: typeShown(type) })}
    </DialogDescription>
  );
}

/** `−12 h` or `+12 h 30 min`: the duration's own words, signed. */
function deltaShown(deltaMinutes: number): string {
  const minutes = Math.abs(deltaMinutes);
  const duration = t(durationMessageKey(minutes), durationValuesOf(minutes));

  return deltaMinutes < 0
    ? t('kalendar.detail.preview.less', { duration })
    : t('kalendar.detail.preview.more', { duration });
}

/**
 * *ŠTO SE MIJENJA* (story 7.9): what a change dialog's choice would do,
 * worded from `@/features/calendar/utils/change-preview`'s codes and
 * operands — the type from and to, who leaves and who arrives, and each
 * member's hours that move, those moving alike in one line. An `<output>`, so
 * it is announced politely as it fills; empty until a choice is made.
 */
export function ChangePreviewOutput({
  id,
  preview,
  snapshot,
}: {
  readonly id: string;
  readonly preview: ChangePreview | null;
  readonly snapshot: CalendarSnapshot | null;
}): ReactNode {
  const out = preview?.roster?.out ?? null;
  const put = preview?.roster?.in ?? null;
  const nameOf = (memberId: string) =>
    previewMemberNameOf(snapshot, memberId) ?? t('kalendar.detail.unknownMember');

  return (
    <output id={id} className="grid min-w-0 gap-1 text-sm">
      {preview === null ? null : (
        <>
          <span className="font-medium">{t('kalendar.detail.preview.heading')}</span>
          <span className="grid gap-1 rounded-md border bg-muted/40 p-3">
            {preview.type === null ? null : (
              <span className="block break-words tabular-nums">
                {t('kalendar.detail.preview.type', { from: typeShown(preview.type.from), to: typeShown(preview.type.to) })}
              </span>
            )}
            {out === null ? null : (
              <span className="block break-words">{t('kalendar.detail.preview.out', { name: nameOf(out) })}</span>
            )}
            {put === null ? null : (
              <span className="block break-words">{t('kalendar.detail.preview.in', { name: nameOf(put) })}</span>
            )}
            {preview.hours.length === 0 ? <span className="block">{t('kalendar.detail.preview.noHours')}</span> : null}
            {preview.hours.map((group) => (
              <span key={group.deltaMinutes} className="block break-words tabular-nums">
                {t('kalendar.detail.preview.hours', {
                  count: group.memberIds.length,
                  names: formatList(group.memberIds.map(nameOf)),
                  delta: deltaShown(group.deltaMinutes),
                })}
              </span>
            ))}
          </span>
        </>
      )}
    </output>
  );
}
