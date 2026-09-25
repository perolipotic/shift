import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { Building2, Check, Clock3, Info, MoveRight, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Callout,
  CalloutAction,
  CalloutBody,
  CalloutDescription,
  CalloutTitle,
} from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { OutputField } from '@/components/ui/output-field';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Timeline,
  TimelineLegend,
  TimelineLegendItem,
  TimelineBoundaries,
  TimelineGap,
  TimelineScale,
  TimelineSegment,
  TimelineTrack,
} from '@/components/ui/timeline';
import {
  DAY_SCALE,
  HOUR_BANDS_LIST_KEY,
  HOUR_BANDS_TABLE,
  durationMessageKey,
  durationValuesOf,
  hourBandDisplayRowsOf,
  hourBandsMessageKey,
  hourBandsSurfaceStateOf,
  partitionBarOf,
  hourBandsQueryOptions,
  hourBandPreviewOf,
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
 * THE ADD FORM IS A DIALOG (design refresh C), opened from the explainer. The
 * dialog stays mounted while closed, so its uncontrolled fields keep a refused
 * value; a successful add closes it and confirms on the page.
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
  const [adding, setAdding] = useState(false);
  /** The start as typed, for the end shown beside it; the field stays uncontrolled. */
  const [typedStart, setTypedStart] = useState(NO_TEXT);

  // The first field, once the dialog is open. The dialog's own effect runs
  // first, so `showModal()` has already moved focus into it.
  useEffect(() => {
    if (adding) nameField.current?.focus();
  }, [adding]);

  const answer = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));

  const { bands, refusal, loading } = hourBandsSurfaceStateOf(answer);
  const rows = bands === null ? null : hourBandDisplayRowsOf(bands);
  const bar = bands === null ? null : partitionBarOf(bands);
  const preview = bands === null ? null : hourBandPreviewOf(bands, typedStart, null);

  function openAdding(): void {
    setFailure(null);
    setCreated(false);
    setAdding(true);
  }

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
      setTypedStart(NO_TEXT);
      setCreated(true);
      // Closed, and the confirmation is on the page; focus returns to the
      // button that opened the dialog.
      setAdding(false);

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
      <Timeline aria-hidden={true}>
        <TimelineScale marks={DAY_SCALE} />
        <TimelineTrack>
          {partition.segments.map((segment) =>
            segment.name === null || segment.tone === null ? (
              <TimelineGap key={segment.key} widthPercent={segment.widthPercent}>
                {/* THE FLAG, on a solid chip over an opaque backing, so the text
                    never sits on the stripes: the chip over the page background
                    is the pair `theme-contrast.test.ts` measures. */}
                <span className="flex min-w-0 rounded-sm bg-background">
                  <span className="truncate rounded-sm bg-modifier-uncovered px-1 text-xs font-medium text-modifier-uncovered-foreground">
                    {t('organization.hourBands.uncovered')}
                  </span>
                </span>
              </TimelineGap>
            ) : (
              <TimelineSegment key={segment.key} tone={segment.tone} widthPercent={segment.widthPercent}>
                <span className="truncate">{segment.name}</span>
              </TimelineSegment>
            ),
          )}
        </TimelineTrack>
        <TimelineBoundaries marks={partition.boundaries} />
      </Timeline>
    );
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>{t('organization.hourBands.heading')}</h1>
          </PageTitle>
          <PageDescription>{t('organization.hourBands.lede')}</PageDescription>
        </div>
        <PageActions>
          <Button asChild variant="outline" className="h-11">
            <Link to="/organizacija">
              <Building2 aria-hidden />
              {t('nav.organizacija')}
            </Link>
          </Button>
        </PageActions>
      </PageHeader>
      <Callout>
        <CalloutBody>
          <IconTile variant="primary">
            <Info />
          </IconTile>
          <div className="min-w-0">
            <CalloutTitle>{t('organization.hourBands.explainerTitle')}</CalloutTitle>
            <CalloutDescription>{t('organization.hourBands.explainerBody')}</CalloutDescription>
          </div>
        </CalloutBody>
        <CalloutAction>
          <Button className="h-11" type="button" onClick={openAdding}>
            <Plus aria-hidden />
            {t('organization.hourBands.open')}
          </Button>
        </CalloutAction>
      </Callout>
      {created ? <Notice role="status">{t('organization.hourBands.created')}</Notice> : null}
      {refusal === null ? null : <Notice role="alert">{t(hourBandsMessageKey(refusal))}</Notice>}
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        aria-labelledby="hour-band-new-heading"
      >
        <DialogHeader
          closeLabel={t('organization.hourBands.close')}
          onClose={() => {
            setAdding(false);
          }}
        >
          <DialogTitle id="hour-band-new-heading">{t('organization.hourBands.addHeading')}</DialogTitle>
        </DialogHeader>
        <form
          method="post"
          onSubmit={(event) => {
            void submit(event);
          }}
          className="grid gap-5"
        >
          <div className="grid gap-2">
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
          <div className="grid gap-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="hour-band-new-start">{t('organization.hourBands.start')}</Label>
                <Input
                  ref={startField}
                  id="hour-band-new-start"
                  name="start"
                  type="time"
                  required
                  defaultValue={NO_TEXT}
                  onChange={(event) => {
                    setCreated(false);
                    setTypedStart(event.currentTarget.value);
                  }}
                  aria-invalid={marksField(failure, HOUR_BAND_START_FIELD)}
                  aria-describedby={failure === null ? 'hour-band-new-end-hint' : 'hour-band-create-error'}
                  className="h-11 w-full"
                />
              </div>
              {/* THE END, COMPUTED, beside the start it follows from: the
                  domain places the typed start among the stored bands and says
                  where it ends. Nothing here is entered or stored. */}
              <div className="grid gap-2">
                <Label htmlFor="hour-band-new-end">{t('organization.hourBands.end')}</Label>
                <OutputField id="hour-band-new-end" htmlFor="hour-band-new-start">
                  <MoveRight aria-hidden />
                  {preview === null ? t('organization.hourBands.endPending') : preview.end}
                </OutputField>
              </div>
            </div>
            <p id="hour-band-new-end-hint" className="text-xs text-muted-foreground">
              {t('organization.hourBands.endHint')}
            </p>
            {preview === null ? null : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('organization.hourBands.duration.label')}</span>
                <span className="font-semibold tabular-nums">
                  {t(durationMessageKey(preview.durationMinutes), durationValuesOf(preview.durationMinutes))}
                </span>
                {preview.crossesMidnight ? (
                  <Badge variant="outline">{t('organization.hourBands.crossesMidnight')}</Badge>
                ) : null}
              </div>
            )}
          </div>
          {/* THE ADD FORM'S OWN REFUSAL, inside the dialog as the form screens
              hold theirs in their card. The list-read refusal belongs to the page. */}
          {failure === null ? null : (
            <Notice id="hour-band-create-error" role="alert">
              {t(hourBandWriteMessageKey(failure))}
            </Notice>
          )}
          <DialogFooter>
            <Button
              className="h-11"
              type="button"
              variant="outline"
              onClick={() => {
                setAdding(false);
              }}
            >
              {t('organization.hourBands.cancel')}
            </Button>
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {t('organization.hourBands.add')}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      {loading ? (
        <div className="grid gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}
      {rows === null || bar === null ? null : (
        <>
          <Card className="min-w-0">
            <CardHeader className="flex-row flex-wrap items-center gap-3">
              <CardTitle asChild>
                <h2>{t('organization.hourBands.listHeading')}</h2>
              </CardTitle>
              {/* STATED, AND STATED AT ZERO (UX-DR20). Not a live region: only
                  confirmations announce. */}
              <Badge variant="secondary">
                {t('organization.hourBands.count', { count: rows.length })}
              </Badge>
            </CardHeader>
            {rows.length === 0 ? null : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('organization.hourBands.name')}</TableHead>
                    <TableHead>{t('organization.hourBands.from')}</TableHead>
                    <TableHead>{t('organization.hourBands.to')}</TableHead>
                    <TableHead>{t('organization.hourBands.duration.label')}</TableHead>
                    <TableHead className="text-right">{t('organization.hourBands.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.band.id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <IconTile variant={row.tone}>
                            <Clock3 />
                          </IconTile>
                          <span className="truncate font-semibold">{row.band.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">{row.start}</TableCell>
                      <TableCell className="tabular-nums">{row.end}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular-nums">
                            {t(durationMessageKey(row.durationMinutes), durationValuesOf(row.durationMinutes))}
                          </span>
                          {/* A pill whose TEXT is the meaning; no status colour. */}
                          {row.crossesMidnight ? (
                            <Badge variant="outline">{t('organization.hourBands.crossesMidnight')}</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" className="h-11 w-11 px-0">
                          <Link to="/organizacija/satni-pojasi/$id" params={{ id: row.band.id }}>
                            <Pencil aria-hidden />
                            <span className="sr-only">
                              {t('organization.hourBands.edit', { name: row.band.name })}
                            </span>
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle asChild>
                <h2>{t('organization.hourBands.timelineHeading')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {renderBar(bar)}
              <TimelineLegend aria-hidden={true}>
                {rows.map((row) => (
                  <TimelineLegendItem key={row.band.id} tone={row.tone}>
                    {row.band.name}
                  </TimelineLegendItem>
                ))}
              </TimelineLegend>
              {/* THE BAR'S TEXT EQUIVALENT: every figure it draws, in words. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <StatTile>
                  <IconTile variant="primary">
                    <Check />
                  </IconTile>
                  <div className="min-w-0">
                    <StatTileLabel>{t('organization.hourBands.covered')}</StatTileLabel>
                    <StatTileValue>
                      {t('organization.hourBands.coveredValue', {
                        covered: t(durationMessageKey(bar.coveredMinutes), durationValuesOf(bar.coveredMinutes)),
                      })}
                    </StatTileValue>
                  </div>
                </StatTile>
                <StatTile>
                  <IconTile>
                    <TriangleAlert />
                  </IconTile>
                  <div className="min-w-0">
                    <StatTileLabel>{t('organization.hourBands.uncovered')}</StatTileLabel>
                    <StatTileValue>
                      {t(durationMessageKey(bar.uncoveredMinutes), durationValuesOf(bar.uncoveredMinutes))}
                    </StatTileValue>
                  </div>
                </StatTile>
              </div>
            </CardContent>
          </Card>
        </>
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
