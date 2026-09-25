import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageHeader, PageTitle } from '@/components/ui/page-header';
import {
  HOUR_BANDS_LIST_KEY,
  HOUR_BANDS_READ_STALE_MS,
  HOUR_BANDS_TABLE,
  durationMessageKey,
  durationValuesOf,
  hourBandDisplayRowsOf,
  hourBandsMessageKey,
  hourBandsSurfaceStateOf,
  partitionBarOf,
  readHourBands,
  type PartitionBar,
} from '@/hour-bands/list';
import {
  HOUR_BAND_NAME_FIELD,
  HOUR_BAND_START_FIELD,
  HOUR_BAND_WRITE_REFUSED,
  HOUR_BAND_WRITE_UNAVAILABLE,
  claimedOrganizationOf,
  createHourBand,
  hourBandWriteMessageKey,
  marksField,
  refusedFieldOf,
  type HourBandWriteFailure,
  type HourBandWriteTable,
} from '@/hour-bands/write';
import { t } from '@/i18n';
import { NO_TEXT, mayReadMembers } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';

/**
 * `/organizacija/satni-pojasi` — the organization's hour bands (story 2.1b).
 *
 * ADMIN ONLY, under the guard `/ljudi/smjene` carries, and NOT a destination:
 * it is reached from `Organizacija`, which lights that tab.
 *
 * ONLY A NAME AND A START ARE ENTERED. Every band's window, duration and
 * midnight flag, and the 24-hour bar beneath them, are shown read-only and come
 * from `@shift/domain` through `@/hour-bands/list` — never computed here.
 *
 * ONE READ (AD-13): the rows, the count and the bar all come from the single
 * `useQuery` under `HOUR_BANDS_LIST_KEY`. The add needs the caller's
 * organization, read from the session's own claim at submit time.
 *
 * THE BAR IS `aria-hidden`. Its text equivalent is the list above it and the
 * coverage sentence beside it, which state every figure it draws in words.
 * Nothing on it is colour alone: each covered stretch carries its band's name,
 * and the uncovered one is hatched AND flagged.
 *
 * THIS FILE HOLDS MARKUP AND STATE. Every rule is in `@/hour-bands/list` and
 * `@/hour-bands/write`, which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

const SKELETON_ROWS = [0, 1, 2];

export function OrganizacijaSatniPojasiScreen() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<HourBandWriteFailure | null>(null);
  const [created, setCreated] = useState(false);

  const answer = useQuery({
    queryKey: HOUR_BANDS_LIST_KEY,
    queryFn: () => readHourBands(supabaseClient().from(HOUR_BANDS_TABLE)),
    staleTime: HOUR_BANDS_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const { bands, refusal, loading } = hourBandsSurfaceStateOf(answer);
  const rows = bands === null ? null : hourBandDisplayRowsOf(bands);
  const bar = bands === null ? null : partitionBarOf(bands);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const start = startField.current;

    if (name === null || start === null || creating.current) return;

    creating.current = true;
    setFailure(null);
    setCreated(false);
    setPending(true);

    try {
      const client = supabaseClient();
      const { data } = await client.auth.getSession();
      const organization = claimedOrganizationOf(data.session?.access_token);

      if (organization === null) {
        setFailure(HOUR_BAND_WRITE_REFUSED);

        return;
      }

      const outcome = await createHourBand(
        client.from(HOUR_BANDS_TABLE) as unknown as HourBandWriteTable,
        organization,
        name.value,
        start.value,
      );

      // A REFUSED SAVE KEEPS THE ENTERED VALUES: both fields are uncontrolled
      // and nothing here clears them on this path (UX-DR34). Focus goes to the
      // field the refusal is about.
      if (!outcome.ok) {
        setFailure(outcome.code);
        (refusedFieldOf(outcome.code) === HOUR_BAND_START_FIELD ? start : name).focus();

        return;
      }

      name.value = NO_TEXT;
      start.value = NO_TEXT;
      setCreated(true);
      // Back to the first field, ready for the next band.
      name.focus();

      try {
        await queryClient.invalidateQueries({ queryKey: HOUR_BANDS_LIST_KEY });
      } catch (cause) {
        console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      setFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  /** The 24-hour bar. Hidden from assistive technology: see the file comment. */
  function renderBar(partition: PartitionBar): ReactNode {
    return (
      <div
        aria-hidden={true}
        className="flex h-11 w-full min-w-0 overflow-hidden rounded-md border border-input"
      >
        {partition.segments.map((segment) =>
          segment.name === null ? (
            <div
              key={segment.key}
              className="hatch-uncovered flex min-w-0 items-center justify-center px-1"
              style={{ width: `${String(segment.widthPercent)}%` }}
            >
              {/* THE FLAG, on a solid chip over an opaque backing, so the text
                  never sits on the stripes: the chip over the page background
                  is the pair `theme-contrast.test.ts` measures. */}
              <span className="flex min-w-0 rounded-sm bg-background">
                <span className="truncate rounded-sm bg-modifier-uncovered px-1 text-xs font-medium text-modifier-uncovered-foreground">
                  {t('organization.hourBands.uncovered')}
                </span>
              </span>
            </div>
          ) : (
            <div
              key={segment.key}
              className="flex min-w-0 items-center justify-center border-r border-background bg-muted px-1 text-xs font-medium last:border-r-0"
              style={{ width: `${String(segment.widthPercent)}%` }}
            >
              <span className="truncate">{segment.name}</span>
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('organization.hourBands.heading')}</h1>
        </PageTitle>
        <PageActions>
          <Button asChild variant="outline" className="h-11">
            <Link to="/organizacija">{t('nav.organizacija')}</Link>
          </Button>
        </PageActions>
      </PageHeader>
      <Card className="w-full min-w-0 max-w-lg">
        <CardContent className="grid gap-4">
          <form
            method="post"
            onSubmit={(event) => {
              void submit(event);
            }}
            className="flex flex-wrap items-end gap-4"
          >
            <div className="grid min-w-0 flex-1 basis-40 gap-2">
              <Label htmlFor="hour-band-new-name">{t('organization.hourBands.name')}</Label>
              <Input
                ref={nameField}
                id="hour-band-new-name"
                name="name"
                type="text"
                required
                defaultValue={NO_TEXT}
                onChange={() => {
                  // A confirmation describes the last save, not what is typed now.
                  setCreated(false);
                }}
                aria-invalid={marksField(failure, HOUR_BAND_NAME_FIELD)}
                aria-describedby={failure === null ? undefined : 'hour-band-create-error'}
                className="h-11 w-full"
              />
            </div>
            <div className="grid min-w-0 basis-32 gap-2">
              <Label htmlFor="hour-band-new-start">{t('organization.hourBands.start')}</Label>
              <Input
                ref={startField}
                id="hour-band-new-start"
                name="start"
                type="time"
                required
                defaultValue={NO_TEXT}
                onChange={() => {
                  setCreated(false);
                }}
                aria-invalid={marksField(failure, HOUR_BAND_START_FIELD)}
                aria-describedby={failure === null ? undefined : 'hour-band-create-error'}
                className="h-11 w-full"
              />
            </div>
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {t('organization.hourBands.add')}
            </Button>
          </form>
          {/* THE ADD FORM'S OWN NOTICES, inside its card as the form screens
              hold theirs. The list-read refusal below belongs to the page. */}
          {failure === null ? null : (
            <Notice id="hour-band-create-error" role="alert">
              {t(hourBandWriteMessageKey(failure))}
            </Notice>
          )}
          {created ? <Notice role="status">{t('organization.hourBands.created')}</Notice> : null}
        </CardContent>
      </Card>
      {refusal === null ? null : <Notice role="alert">{t(hourBandsMessageKey(refusal))}</Notice>}
      {loading ? (
        <div className="grid gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}
      {rows === null || bar === null ? null : (
        <section className="grid min-w-0 gap-4">
          {/* STATED, AND STATED AT ZERO (UX-DR20). Not a live region: only
              confirmations announce. */}
          <p className="text-sm text-muted-foreground">
            {t('organization.hourBands.count', { count: rows.length })}
          </p>
          <ul className="grid gap-4">
            {rows.map((row) => (
              <li key={row.band.id} className="grid min-w-0 gap-2">
                <Button asChild variant="outline" className="h-11 w-full justify-start">
                  <Link to="/organizacija/satni-pojasi/$id" params={{ id: row.band.id }}>
                    <span className="truncate">
                      {t('organization.hourBands.edit', { name: row.band.name })}
                    </span>
                  </Link>
                </Button>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <dl className="flex flex-wrap gap-x-4 gap-y-1">
                    <div className="flex gap-1">
                      <dt className="text-muted-foreground">{t('organization.hourBands.window')}</dt>
                      <dd className="tabular-nums">{row.window}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-muted-foreground">
                        {t('organization.hourBands.duration.label')}
                      </dt>
                      <dd className="tabular-nums">
                        {t(durationMessageKey(row.durationMinutes), durationValuesOf(row.durationMinutes))}
                      </dd>
                    </div>
                  </dl>
                  {/* A pill whose TEXT is the meaning; no status colour. */}
                  {row.crossesMidnight ? (
                    <Badge variant="secondary">{t('organization.hourBands.crossesMidnight')}</Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            {t('organization.hourBands.coverage', {
              covered: t(durationMessageKey(bar.coveredMinutes), durationValuesOf(bar.coveredMinutes)),
              uncovered: t(
                durationMessageKey(bar.uncoveredMinutes),
                durationValuesOf(bar.uncoveredMinutes),
              ),
            })}
          </p>
          {renderBar(bar)}
        </section>
      )}
    </main>
  );
}

export const organizacijaSatniPojasiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/organizacija/satni-pojasi',
  /** The guard `/ljudi/smjene` carries, copied verbatim; `router.test.ts` drives it. */
  beforeLoad: async ({ context }) => {
    let outcome: MemberRoleOutcome;

    try {
      outcome = await context.currentMemberRole();
    } catch (cause) {
      console.error(MEMBER_ROLE_UNAVAILABLE, cause);

      outcome = { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
    }

    if (mayReadMembers(outcome)) return;

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  },
  component: OrganizacijaSatniPojasiScreen,
});
