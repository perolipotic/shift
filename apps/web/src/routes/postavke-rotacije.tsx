import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/i18n';
import { NO_TEXT, mayReadMembers, shownDate } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import {
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_TABLE,
  SHIFT_TYPES_TABLE,
  SHIFT_TYPE_VERSIONS_TABLE,
  durationValuesOf,
  shiftTypeDurationMessageKey,
  shiftTypeListOf,
  shiftTypesMessageKey,
  shiftTypesQueryOptions,
  shiftTypesSurfaceStateOf,
  shiftTypesTodayOf,
  type ShiftTypeDisplayRow,
} from '@/shift-types/list';
import {
  SHIFT_TYPE_END_FIELD,
  SHIFT_TYPE_KINDS,
  SHIFT_TYPE_NAME_FIELD,
  SHIFT_TYPE_START_FIELD,
  SHIFT_TYPE_WORKING,
  SHIFT_TYPE_WRITE_REFUSED,
  SHIFT_TYPE_WRITE_UNAVAILABLE,
  claimedOrganizationOf,
  createShiftType,
  createdOutcomeOf,
  marksField,
  refusedFieldOf,
  shiftTypeKindMessageKey,
  shiftTypeKindOf,
  shiftTypeSavedMessageKey,
  shiftTypeWriteMessageKey,
  type ShiftTypeSaved,
  type ShiftTypeVersionWriteTable,
  type ShiftTypeWriteFailure,
  type ShiftTypeWriteTable,
} from '@/shift-types/write';
import { supabaseClient } from '@/supabase/client';

/**
 * `Postavke rotacije` — the organization's shift types (story 2.2b).
 *
 * ADMIN ONLY (UX-DR32), under the guard `/ljudi/smjene` carries. The rotation
 * builder (2.3) joins this screen later; today it holds its first section,
 * `Tipovi smjena`: the types in use, each in its ramp-slot chip with its times
 * and duration, an add form, and the archived types listed separately and
 * read-only.
 *
 * THE CHIP ALWAYS CARRIES THE NAME AS TEXT; the slot colour only reinforces
 * it, so a seventh working type — slot 1 again — is told apart by its name.
 * The slot, the times, the duration and the midnight flag all come from
 * `@/shift-types/list`, which reads `@shift/domain`; nothing is computed here.
 *
 * ONE READ (AD-13) under `SHIFT_TYPES_LIST_KEY`, which carries the
 * organization's zone, so "today" — the date a new type's first times take
 * effect from — is the organization's, never the device's.
 *
 * THIS FILE HOLDS MARKUP AND STATE. Every rule is in `@/shift-types/list` and
 * `@/shift-types/write`, which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

const SKELETON_ROWS = [0, 1, 2];

export function PostavkeRotacijeScreen() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const kindField = useRef<HTMLSelectElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const endField = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  const [pending, setPending] = useState(false);
  const [working, setWorking] = useState(true);
  const [failure, setFailure] = useState<ShiftTypeWriteFailure | null>(null);
  const [saved, setSaved] = useState<ShiftTypeSaved | null>(null);

  const answer = useQuery(
    shiftTypesQueryOptions(() => supabaseClient().from(SHIFT_TYPES_READ_TABLE)),
  );

  const { snapshot, refusal, loading } = shiftTypesSurfaceStateOf(answer);
  const today = snapshot === null ? null : shiftTypesTodayOf(snapshot, new Date());
  const list = snapshot === null || today === null ? null : shiftTypeListOf(snapshot, today);

  /** The kind decides whether times are offered; a confirmation describes the last save. */
  function chooseKind(event: ChangeEvent<HTMLSelectElement>): void {
    setSaved(null);
    setWorking(shiftTypeKindOf(event.target.value) === SHIFT_TYPE_WORKING);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const kind = kindField.current;

    if (name === null || kind === null || creating.current) return;

    creating.current = true;
    setFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const client = supabaseClient();
      const { data } = await client.auth.getSession();
      const organization = claimedOrganizationOf(data.session?.access_token);

      if (organization === null) {
        setFailure(SHIFT_TYPE_WRITE_REFUSED);

        return;
      }

      const outcome = await createShiftType(
        {
          types: client.from(SHIFT_TYPES_TABLE) as unknown as ShiftTypeWriteTable,
          versions: client.from(SHIFT_TYPE_VERSIONS_TABLE) as unknown as ShiftTypeVersionWriteTable,
        },
        organization,
        {
          name: name.value,
          kind: shiftTypeKindOf(kind.value),
          start: startField.current?.value ?? NO_TEXT,
          end: endField.current?.value ?? NO_TEXT,
        },
        today,
      );

      // WHAT HAPPENS NEXT IS `createdOutcomeOf`'s, executed by the node
      // suite. A REFUSED ADD KEEPS THE ENTERED VALUES: every field is
      // uncontrolled and nothing clears them on that path (UX-DR34). A type
      // added WITHOUT its times exists, so the form is cleared and the
      // message says the times are still to be set.
      const next = createdOutcomeOf(outcome);

      setSaved(next.saved);
      setFailure(next.failure);

      if (!next.clearForm) {
        const field =
          next.failure === null ? SHIFT_TYPE_NAME_FIELD : refusedFieldOf(next.failure, SHIFT_TYPE_NAME_FIELD);

        (field === SHIFT_TYPE_START_FIELD ? startField.current : name)?.focus();
      } else {
        name.value = NO_TEXT;
        if (startField.current !== null) startField.current.value = NO_TEXT;
        if (endField.current !== null) endField.current.value = NO_TEXT;
        // Back to the first field, ready for the next type.
        name.focus();
      }

      if (!next.refetch) return;

      try {
        await queryClient.invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY });
      } catch (cause) {
        console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      setFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  /** The start and end, offered only for a working type. */
  function renderTimeFields(): ReactNode {
    return (
      <div className="flex flex-wrap gap-4">
        <div className="grid min-w-0 flex-1 basis-32 gap-2">
          <Label htmlFor="shift-type-new-start">{t('rotation.shiftTypes.start')}</Label>
          <Input
            ref={startField}
            id="shift-type-new-start"
            name="start"
            type="time"
            required
            defaultValue={NO_TEXT}
            onChange={() => {
              setSaved(null);
            }}
            aria-invalid={marksField(failure, SHIFT_TYPE_START_FIELD)}
            aria-describedby={failure === null ? undefined : 'shift-type-create-error'}
            className="h-11 w-full"
          />
        </div>
        <div className="grid min-w-0 flex-1 basis-32 gap-2">
          <Label htmlFor="shift-type-new-end">{t('rotation.shiftTypes.end')}</Label>
          <Input
            ref={endField}
            id="shift-type-new-end"
            name="end"
            type="time"
            required
            defaultValue={NO_TEXT}
            onChange={() => {
              setSaved(null);
            }}
            aria-invalid={marksField(failure, SHIFT_TYPE_END_FIELD)}
            aria-describedby={failure === null ? undefined : 'shift-type-create-error'}
            className="h-11 w-full"
          />
        </div>
      </div>
    );
  }

  /** A type's times, duration and flags, read-only. */
  function renderFacts(row: ShiftTypeDisplayRow): ReactNode {
    if (!row.type.isWorking) {
      return <Badge variant="secondary">{t('rotation.shiftTypes.nonworking')}</Badge>;
    }

    return (
      <>
        {row.times === null ? (
          <p className="text-muted-foreground">{t('rotation.shiftTypes.noTimes')}</p>
        ) : (
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex gap-1">
              <dt className="text-muted-foreground">{t('rotation.shiftTypes.times')}</dt>
              <dd className="tabular-nums">{row.times.range}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted-foreground">{t('rotation.shiftTypes.duration.label')}</dt>
              <dd className="tabular-nums">
                {t(
                  shiftTypeDurationMessageKey(row.times.durationMinutes),
                  durationValuesOf(row.times.durationMinutes),
                )}
              </dd>
            </div>
          </dl>
        )}
        {/* A pill whose TEXT is the meaning; no status colour. */}
        {row.times?.crossesMidnight === true ? (
          <Badge variant="secondary">{t('rotation.shiftTypes.crossesMidnight')}</Badge>
        ) : null}
        {row.scheduled === null ? null : (
          <p className="basis-full tabular-nums">
            {t('rotation.shiftTypes.scheduled', {
              date: shownDate(row.scheduled.from),
              range: row.scheduled.times.range,
              duration: t(
                shiftTypeDurationMessageKey(row.scheduled.times.durationMinutes),
                durationValuesOf(row.scheduled.times.durationMinutes),
              ),
            })}
          </p>
        )}
      </>
    );
  }

  /** One type. An archived one is read-only: no link to edit it. */
  function renderRow(row: ShiftTypeDisplayRow): ReactNode {
    return (
      <li key={row.type.id} className="grid min-w-0 gap-2">
        {row.type.archived ? null : (
          <Button asChild variant="outline" className="h-11 w-full justify-start">
            <Link to="/postavke-rotacije/tipovi-smjena/$id" params={{ id: row.type.id }}>
              <span className="truncate">
                {t('rotation.shiftTypes.edit', { name: row.type.name })}
              </span>
            </Link>
          </Button>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {/* THE CHIP: the slot's colour, and ALWAYS the name as text. */}
          <span className={row.chipClass}>
            <span className="truncate">{row.type.name}</span>
          </span>
          {renderFacts(row)}
        </div>
      </li>
    );
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.postavkeRotacije')}</h1>
        </PageTitle>
      </PageHeader>
      <section className="grid min-w-0 gap-6">
        <h2 className="text-lg font-bold">{t('rotation.shiftTypes.heading')}</h2>
        <Card className="w-full min-w-0 max-w-lg">
          <CardContent className="grid gap-4">
            <form
              method="post"
              onSubmit={(event) => {
                void submit(event);
              }}
              className="grid gap-4"
            >
              <div className="grid gap-2">
                <Label htmlFor="shift-type-new-name">{t('rotation.shiftTypes.name')}</Label>
                <Input
                  ref={nameField}
                  id="shift-type-new-name"
                  name="name"
                  type="text"
                  required
                  defaultValue={NO_TEXT}
                  onChange={() => {
                    // A confirmation describes the last save, not what is typed now.
                    setSaved(null);
                  }}
                  aria-invalid={marksField(failure, SHIFT_TYPE_NAME_FIELD)}
                  aria-describedby={failure === null ? undefined : 'shift-type-create-error'}
                  className="h-11 w-full"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shift-type-new-kind">{t('rotation.shiftTypes.kind')}</Label>
                {/* A NATIVE `<select>`, as the role control on `/ljudi/novi`
                    is: `components/ui/` holds no Select primitive. Chosen once:
                    `is_working` cannot change after creation. */}
                <select
                  ref={kindField}
                  id="shift-type-new-kind"
                  name="kind"
                  defaultValue={SHIFT_TYPE_WORKING}
                  onChange={chooseKind}
                  aria-describedby={failure === null ? undefined : 'shift-type-create-error'}
                  className="flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {SHIFT_TYPE_KINDS.map((option) => (
                    <option key={option} value={option}>
                      {t(shiftTypeKindMessageKey(option))}
                    </option>
                  ))}
                </select>
              </div>
              {/* A NON-WORKING TYPE HAS NO TIMES, so it is offered none. */}
              {working ? renderTimeFields() : null}
              <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
                {t('rotation.shiftTypes.add')}
              </Button>
            </form>
            {/* THE ADD FORM'S OWN NOTICES, inside its card. The list-read
                refusal below belongs to the page. */}
            {failure === null ? null : (
              <Notice id="shift-type-create-error" role="alert">
                {t(shiftTypeWriteMessageKey(failure))}
              </Notice>
            )}
            {saved === null ? null : (
              <Notice role="status">{t(shiftTypeSavedMessageKey(saved))}</Notice>
            )}
          </CardContent>
        </Card>
        {refusal === null ? null : (
          <Notice role="alert">{t(shiftTypesMessageKey(refusal))}</Notice>
        )}
        {loading ? (
          <div className="grid gap-2">
            {SKELETON_ROWS.map((row) => (
              <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : null}
        {list === null ? null : (
          <div className="grid min-w-0 gap-4">
            {/* STATED, AND STATED AT ZERO (UX-DR20). Not a live region. */}
            <p className="text-sm text-muted-foreground">
              {t('rotation.shiftTypes.count', { count: list.active.length })}
            </p>
            <ul className="grid gap-4">{list.active.map((row) => renderRow(row))}</ul>
          </div>
        )}
        {list === null || list.archived.length === 0 ? null : (
          <div className="grid min-w-0 gap-4">
            <h3 className="text-base font-bold">{t('rotation.shiftTypes.archivedHeading')}</h3>
            <ul className="grid gap-4">{list.archived.map((row) => renderRow(row))}</ul>
          </div>
        )}
      </section>
    </main>
  );
}

export const postavkeRotacijeRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/postavke-rotacije',
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
  component: PostavkeRotacijeScreen,
});
