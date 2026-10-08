/**
 * `Kopiraj` beside a one-time credential (story 7.8): the copy, and what it
 * says afterwards.
 *
 * THE CLIPBOARD IS A PARAMETER, so both outcomes run in the node suite
 * (`credential-copy.test.ts`) with no browser. `navigator.clipboard` is absent
 * outside a secure context and `writeText` rejects without permission, and
 * either way the admin is told to write the password down — the one copy is
 * still on screen. The failure is SWALLOWED, never logged: its cause can carry
 * nothing useful, and the value it was handed is the credential.
 */

/** The copy landed. */
export const CREDENTIAL_COPIED = 'copied';
/** It did not, for whichever reason. */
export const CREDENTIAL_NOT_COPIED = 'notCopied';

export type CredentialCopy = typeof CREDENTIAL_COPIED | typeof CREDENTIAL_NOT_COPIED;

/** As much of `navigator.clipboard` as the copy uses. */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** Copies the credential, answering whether it landed. Never throws. */
export async function copyCredential(
  clipboard: ClipboardWriter | undefined,
  credential: string,
): Promise<CredentialCopy> {
  if (clipboard === undefined) return CREDENTIAL_NOT_COPIED;

  try {
    await clipboard.writeText(credential);

    return CREDENTIAL_COPIED;
  } catch {
    return CREDENTIAL_NOT_COPIED;
  }
}

/** The status line each outcome renders as. */
export function credentialCopyMessageKey(
  outcome: CredentialCopy,
): 'ljudi.form.copied' | 'ljudi.form.copyFailed' {
  return outcome === CREDENTIAL_COPIED ? 'ljudi.form.copied' : 'ljudi.form.copyFailed';
}
