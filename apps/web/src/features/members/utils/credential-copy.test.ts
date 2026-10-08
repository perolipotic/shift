import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_COPIED,
  CREDENTIAL_NOT_COPIED,
  copyCredential,
  credentialCopyMessageKey,
} from '@/features/members/utils/credential-copy';

describe('Kopiraj beside a one-time credential (story 7.8)', () => {
  it('copies the credential it is handed, and says so', async () => {
    const written: string[] = [];

    const outcome = await copyCredential(
      {
        writeText: (text) => {
          written.push(text);

          return Promise.resolve();
        },
      },
      'kosa-more-lipa-sat',
    );

    expect(written).toEqual(['kosa-more-lipa-sat']);
    expect(outcome).toBe(CREDENTIAL_COPIED);
    expect(credentialCopyMessageKey(outcome)).toBe('ljudi.form.copied');
  });

  it('answers a refused write as not copied, and never throws', async () => {
    const outcome = await copyCredential(
      { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      'kosa-more-lipa-sat',
    );

    expect(outcome).toBe(CREDENTIAL_NOT_COPIED);
    expect(credentialCopyMessageKey(outcome)).toBe('ljudi.form.copyFailed');
  });

  it('answers a missing clipboard as not copied', async () => {
    await expect(copyCredential(undefined, 'kosa-more-lipa-sat')).resolves.toBe(
      CREDENTIAL_NOT_COPIED,
    );
  });
});
