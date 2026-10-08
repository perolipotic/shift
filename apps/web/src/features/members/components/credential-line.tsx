import { Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import {
  copyCredential,
  credentialCopyMessageKey,
  type CredentialCopy,
} from '@/features/members/utils/credential-copy';
import { t } from '@/lib/i18n';

/**
 * A one-time credential's line (story 7.8): the password in a monospace face,
 * `Kopiraj` beside it, and what the copy did as a `Notice role="status"`.
 *
 * ONE COMPONENT FOR BOTH SHOWINGS — the create form's initial password and the
 * member page's reset — so the two cannot drift apart. The copy's outcome is
 * this line's own state: it belongs to the one showing and goes with it.
 */
export function CredentialLine({ password }: { readonly password: string }): ReactNode {
  const [copied, setCopied] = useState<CredentialCopy | null>(null);

  async function copy(): Promise<void> {
    // `navigator.clipboard` is absent outside a secure context, so it is read
    // here, where `copyCredential` can refuse it, and never assumed.
    setCopied(await copyCredential(navigator.clipboard as Clipboard | undefined, password));
  }

  return (
    <div className="grid gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
        {/* DATA, never a key, in a monospace face. `break-words`, never
            `break-all`: the hyphens between the four words are where it wraps,
            and a word split across two lines is misread aloud. */}
        <p className="min-w-0 break-words font-mono text-base font-bold">{password}</p>
        <Button
          className="h-11 shrink-0"
          type="button"
          variant="outline"
          onClick={() => {
            void copy();
          }}
        >
          <Copy aria-hidden />
          {t('ljudi.form.copy')}
        </Button>
      </div>
      {copied === null ? null : <Notice role="status">{t(credentialCopyMessageKey(copied))}</Notice>}
    </div>
  );
}
