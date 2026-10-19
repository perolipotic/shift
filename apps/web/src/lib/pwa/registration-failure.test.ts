import { describe, expect, it, vi } from 'vitest';

import {
  reportRegistrationFailure,
  reportUpdateCheckFailure,
  SERVICE_WORKER_REGISTRATION_FAILED,
  SERVICE_WORKER_UPDATE_CHECK_FAILED,
} from '@/lib/pwa/registration-failure';

describe('a failed service worker registration is reported, never shown', () => {
  it('warns with the cause under the stable code', () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cause = new Error('register rejected');

    try {
      reportRegistrationFailure(cause);

      expect(logged).toHaveBeenCalledWith(SERVICE_WORKER_REGISTRATION_FAILED, cause);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('a failed update check is reported, never shown', () => {
  it('warns with the cause under the stable code', () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cause = new Error('update rejected');

    try {
      reportUpdateCheckFailure(cause);

      expect(logged).toHaveBeenCalledWith(SERVICE_WORKER_UPDATE_CHECK_FAILED, cause);
    } finally {
      logged.mockRestore();
    }
  });
});
