import { BriefcaseBusiness } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { NO_TEXT } from '@/features/members/services/list';
import type { ShiftTypeListScreen } from '@/features/shift-types/hooks/use-shift-type-list';
import {
  SHIFT_TYPE_END_FIELD,
  SHIFT_TYPE_KINDS,
  SHIFT_TYPE_NAME_FIELD,
  SHIFT_TYPE_START_FIELD,
  SHIFT_TYPE_WORKING,
  marksField,
  shiftTypeKindMessageKey,
  shiftTypeWriteMessageKey,
} from '@/features/shift-types/services/write';
import { t } from '@/lib/i18n';

/** The start and end, offered only for a working type. */
function renderTimeFields(screen: ShiftTypeListScreen): ReactNode {
  const { startField, endField, failure, setSaved } = screen;

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

/**
 * The add form, in a dialog opened from the section's header (design refresh
 * C). Every field is uncontrolled, so a refused add keeps what was typed.
 */
export function ShiftTypeAddDialog({ screen }: { readonly screen: ShiftTypeListScreen }): ReactNode {
  const { adding, setAdding, submit, nameField, kindField, failure, setSaved, chooseKind, working, pending } =
    screen;

  return (
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
              Chosen once: the kind cannot change after creation. */}
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
        {working ? renderTimeFields(screen) : null}
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
  );
}
