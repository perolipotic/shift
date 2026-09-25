import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { BriefcaseBusiness, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { PageDescription, PageTitle } from '@/components/ui/page-header';
import { SectionNumber } from '@/components/ui/section-number';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { t } from '@/i18n';
import { NO_TEXT, mayReadMembers, shownDate } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { ROTATION_KEY } from '@/rotation/list';
import { RotationSection } from '@/rotation/rotation-section';
import { appLayoutRoute } from '@/routes/_app';
import {
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_TABLE,
  SHIFT_TYPES_TABLE,
  SHIFT_TYPE_VERSIONS_TABLE,
  NO_TIMES_SHOWN,
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
 * ADMIN ONLY (UX-DR32), under the guard `/ljudi/smjene` carries. Its first
 * section is `Tipovi smjena`: the types in use, each in its ramp-slot chip with
 * its times and duration, an add form, and the archived types listed
 * separately and read-only. Below it, the rotation builder (story 2.3b,
 * `@/rotation/rotation-section`), which reads its own snapshot — so a shift
 * type write invalidates `ROTATION_KEY` as well.
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
 * A TABLE AND A DIALOG (design refresh C): the types in a table, the add form
 * in a dialog opened from the header, and each type edited in a dialog over
 * this list by `/postavke-rotacije/tipovi-smjena/$id`.
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
  const [adding, setAdding] = useState(false);

  // The first field, once the dialog is open. The dialog's own effect runs
  // first, so `showModal()` has already moved focus into it.
  useEffect(() => {
    if (adding) nameField.current?.focus();
  }, [adding]);

  function openAdding(): void {
    setFailure(null);
    setSaved(null);
    setAdding(true);
  }

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
        // Closed, and the outcome is on the page; focus returns to the
        // button that opened the dialog.
        setAdding(false);
      }

      if (!next.refetch) return;

      try {
        // The rotation builder below draws the types too, from its own
        // snapshot. Both re-reads start together, so one failing cannot skip
        // the other.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY }),
          queryClient.invalidateQueries({ queryKey: ROTATION_KEY }),
        ]);
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
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
        <div className="grid min-w-0 gap-2">
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

  /** A non-working type's times and duration: none, shown as a dash. */
  function renderNoTimes(): ReactNode {
    return (
      <span className="text-muted-foreground">{NO_TIMES_SHOWN}</span>
    );
  }

  /** A type's times and flags, read-only, in the table's time column. */
  function renderTimes(row: ShiftTypeDisplayRow): ReactNode {
    // A NON-WORKING TYPE HAS NO TIMES, and says so with a dash — the kind
    // column is gone (owner layout); its chip keeps its name.
    if (!row.type.isWorking) return renderNoTimes();

    return (
      <div className="grid gap-1">
        {row.times === null ? (
          <span className="text-muted-foreground">{t('rotation.shiftTypes.noTimes')}</span>
        ) : (
          <span className="tabular-nums">{row.times.range}</span>
        )}
        {row.scheduled === null ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('rotation.shiftTypes.scheduled', {
              date: shownDate(row.scheduled.from),
              range: row.scheduled.times.range,
              duration: t(
                shiftTypeDurationMessageKey(row.scheduled.times.durationMinutes),
                durationValuesOf(row.scheduled.times.durationMinutes),
              ),
            })}
          </span>
        )}
      </div>
    );
  }

  function renderDuration(row: ShiftTypeDisplayRow): ReactNode {
    if (!row.type.isWorking) return renderNoTimes();
    if (row.times === null) return null;

    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums">
          {t(
            shiftTypeDurationMessageKey(row.times.durationMinutes),
            durationValuesOf(row.times.durationMinutes),
          )}
        </span>
        {/* A pill whose TEXT is the meaning; no status colour. */}
        {row.times.crossesMidnight ? (
          <Badge variant="outline">{t('rotation.shiftTypes.crossesMidnight')}</Badge>
        ) : null}
      </div>
    );
  }

  /** One type as a table row. An archived one is read-only: no link to edit it. */
  function renderRow(row: ShiftTypeDisplayRow): ReactNode {
    return (
      <TableRow key={row.type.id}>
        <TableCell>
          {/* THE CHIP: the slot's colour, and ALWAYS the name as text. */}
          <span className={row.chipClass}>
            <span className="truncate">{row.type.name}</span>
          </span>
        </TableCell>
        <TableCell>{renderTimes(row)}</TableCell>
        <TableCell>{renderDuration(row)}</TableCell>
        <TableCell className="text-right">
          {row.type.archived ? null : (
            <Button asChild variant="ghost" className="h-11 w-11 px-0">
              <Link to="/postavke-rotacije/tipovi-smjena/$id" params={{ id: row.type.id }}>
                <Pencil aria-hidden />
                <span className="sr-only">{t('rotation.shiftTypes.edit', { name: row.type.name })}</span>
              </Link>
            </Button>
          )}
        </TableCell>
      </TableRow>
    );
  }

  function renderTable(rows: readonly ShiftTypeDisplayRow[]): ReactNode {
    if (rows.length === 0) return null;

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('rotation.shiftTypes.columnName')}</TableHead>
            <TableHead>{t('rotation.shiftTypes.times')}</TableHead>
            <TableHead>{t('rotation.shiftTypes.duration.label')}</TableHead>
            <TableHead className="text-right">{t('rotation.shiftTypes.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{rows.map((row) => renderRow(row))}</TableBody>
      </Table>
    );
  }

  /**
   * SECTION 1, the shift types, as the builder places it: beside the pattern
   * from `lg` up, stacked above it below. The add opens from the card's own
   * header now; the archived types follow in a card of their own.
   */
  function renderShiftTypes(): ReactNode {
    return (
      <div className="grid min-w-0 gap-6">
        {/* THE ADD'S OUTCOME ON THE PAGE once the dialog has closed — the
            confirmation, or a type added without its times — above the
            section it is about. */}
        {adding || saved === null ? null : (
          <Notice role="status">{t(shiftTypeSavedMessageKey(saved))}</Notice>
        )}
        {adding || failure === null ? null : (
          <Notice role="alert">{t(shiftTypeWriteMessageKey(failure))}</Notice>
        )}
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
          <Card className="min-w-0">
            <CardHeader className="flex-row flex-wrap items-center gap-3">
              <SectionNumber value={1} />
              <CardTitle asChild>
                <h2>{t('rotation.shiftTypes.heading')}</h2>
              </CardTitle>
              {/* STATED, AND STATED AT ZERO (UX-DR20). Not a live region. */}
              <Badge variant="secondary">
                {t('rotation.shiftTypes.count', { count: list.active.length })}
              </Badge>
              <Button className="ml-auto h-11" type="button" onClick={openAdding}>
                <Plus aria-hidden />
                {t('rotation.shiftTypes.open')}
              </Button>
            </CardHeader>
            {renderTable(list.active)}
          </Card>
        )}
        {list === null || list.archived.length === 0 ? null : (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle asChild>
                <h2>{t('rotation.shiftTypes.archivedHeading')}</h2>
              </CardTitle>
            </CardHeader>
            {renderTable(list.archived)}
          </Card>
        )}
      </div>
    );
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      {/* THE OWNER LAYOUT (story 2.3b): the page header, with `Spremi
          rotaciju` among its actions, and the four numbered sections are laid
          out by the rotation builder; this screen hands it its title and
          section 1, the shift types. */}
      <RotationSection
        heading={
          <div className="min-w-0">
            <PageTitle asChild>
              <h1>{t('nav.postavkeRotacije')}</h1>
            </PageTitle>
            <PageDescription>{t('rotation.shiftTypes.lede')}</PageDescription>
          </div>
        }
        shiftTypes={renderShiftTypes()}
      />
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        aria-labelledby="shift-type-new-heading"
      >
        <DialogHeader
          closeLabel={t('rotation.shiftTypes.close')}
          onClose={() => {
            setAdding(false);
          }}
        >
          <DialogTitle id="shift-type-new-heading">{t('rotation.shiftTypes.addHeading')}</DialogTitle>
        </DialogHeader>
        <form
          method="post"
          onSubmit={(event) => {
            void submit(event);
          }}
          className="grid gap-5"
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
            {/* The native `Select`, as the role control on `/ljudi/novi` is.
                Chosen once: `is_working` cannot change after creation. */}
            <InputGroup>
              <InputGroupIcon>
                <BriefcaseBusiness />
              </InputGroupIcon>
              <Select
                ref={kindField}
                id="shift-type-new-kind"
                name="kind"
                defaultValue={SHIFT_TYPE_WORKING}
                onChange={chooseKind}
                aria-describedby={failure === null ? undefined : 'shift-type-create-error'}
                className="h-11"
              >
                {SHIFT_TYPE_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {t(shiftTypeKindMessageKey(option))}
                  </option>
                ))}
              </Select>
            </InputGroup>
          </div>
          {/* A NON-WORKING TYPE HAS NO TIMES, so it is offered none. */}
          {working ? renderTimeFields() : null}
          {/* THE ADD FORM'S OWN REFUSAL, inside the dialog while it is open. */}
          {!adding || failure === null ? null : (
            <Notice id="shift-type-create-error" role="alert">
              {t(shiftTypeWriteMessageKey(failure))}
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
              {t('rotation.shiftTypes.cancel')}
            </Button>
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {t('rotation.shiftTypes.add')}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
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
