import { Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { NO_TEXT } from '@/features/members/services/list';
import type { TeamListScreen } from '@/features/teams/hooks/use-team-list';
import { teamWriteMessageKey } from '@/features/teams/services/write';
import { t } from '@/lib/i18n';

/**
 * THE ADD FORM IS A DIALOG (design refresh C), opened from the page header.
 * The dialog stays mounted while closed, so its uncontrolled field keeps a
 * refused value; a successful add closes it and confirms on the page.
 */
export function TeamAddDialog({ screen }: { readonly screen: TeamListScreen }): ReactNode {
  const { adding, setAdding, submit, nameField, setCreated, failure, pending } = screen;

  return (
    <Dialog open={adding} onOpenChange={setAdding} aria-labelledby="team-new-heading">
      <DialogHeader
        closeLabel={t('smjene.close')}
        onClose={() => {
          setAdding(false);
        }}
      >
        <DialogTitle id="team-new-heading">{t('smjene.addHeading')}</DialogTitle>
      </DialogHeader>
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="team-new-name">{t('smjene.name')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <Users />
            </InputGroupIcon>
            <Input
              ref={nameField}
              id="team-new-name"
              name="name"
              type="text"
              required
              defaultValue={NO_TEXT}
              onChange={() => {
                // A confirmation describes the last save, not what is typed now.
                setCreated(false);
              }}
              aria-invalid={failure !== null}
              aria-describedby={failure === null ? undefined : 'team-create-error'}
              className="h-11 w-full"
            />
          </InputGroup>
        </div>
        {/* THE CREATE FORM'S OWN REFUSAL, inside the dialog. The list-read
            refusal belongs to the page. */}
        {failure === null ? null : (
          <Notice id="team-create-error" role="alert">
            {t(teamWriteMessageKey(failure))}
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
            {t('smjene.cancel')}
          </Button>
          <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
            {t('smjene.add')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
