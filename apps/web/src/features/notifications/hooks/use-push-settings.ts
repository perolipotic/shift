import { useCallback, useEffect, useRef, useState } from 'react';

import { pagePush, pushBackend, vapidPublicKey } from '@/features/notifications/services/page-push';
import {
  DEVICE_UNAVAILABLE,
  PUSH_DENIED,
  PUSH_DISMISSED,
  deviceAfter,
  pushConfigured,
  pushViewOf,
  readPushDevice,
  switchableOn,
  turnPushOff,
  turnPushOn,
  whenVisibleAgain,
  type PushDevice,
} from '@/features/notifications/services/push';
import { INSTALL_IOS } from '@/lib/pwa/install';
import { useInstall } from '@/lib/pwa/use-install';
import { writesOnline } from '@/lib/offline/use-write-gate';

/**
 * `/obavijesti`'s push section (story 10.4): this device's state and its one
 * choice. The state is the device's, read on each visit, never cached in the
 * query cache: it lives in the browser as much as in the database.
 *
 * THE CHOICE SAVES AT ONCE, as the email one does: while it is in flight the
 * chosen value is drawn and the control is busy. On asks the browser's
 * permission (the only place anything does, and only after the press),
 * subscribes and registers; off deletes the row and unsubscribes. A failure
 * draws the stored value again with the failure notice; a permission denied at
 * the prompt reads the device again, which then says push is blocked; a
 * dismissed prompt simply leaves it off. A press while the device is being
 * read does nothing. The device is read again whenever the page comes back
 * into view: the permission may have changed in the browser's settings.
 */
export function usePushSettings() {
  const install = useInstall();
  const [device, setDevice] = useState<PushDevice | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const saving = useRef(false);
  const readingNow = useRef(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);

  const read = useCallback(async (): Promise<void> => {
    readingNow.current = true;
    setReading(true);
    try {
      let backend;
      try {
        backend = pushBackend();
      } catch {
        setDevice(DEVICE_UNAVAILABLE);
        return;
      }
      setDevice(await readPushDevice(pagePush, backend));
    } finally {
      readingNow.current = false;
      setReading(false);
    }
  }, []);

  useEffect(() => {
    void read();
    return whenVisibleAgain(document, () => {
      if (!saving.current) void read();
    });
  }, [read]);

  const view = pushViewOf({
    configured: pushConfigured(vapidPublicKey()),
    iosInstall: install.kind === INSTALL_IOS,
    device,
  });

  async function save(on: boolean): Promise<void> {
    const current = switchableOn(device);
    if (saving.current || readingNow.current || current === null) return;
    if (!writesOnline()) return;
    if (on === current) return;

    saving.current = true;
    setPending(on);
    setFailed(false);
    setSaved(null);

    try {
      const written = on
        ? await turnPushOn(pagePush, pushBackend(), vapidPublicKey())
        : await turnPushOff(pagePush, pushBackend());

      if (written.ok) {
        setDevice(deviceAfter(written.on));
        setSaved(written.on);
        return;
      }
      if (written.code === PUSH_DENIED) {
        await read();
        return;
      }
      if (written.code !== PUSH_DISMISSED) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      saving.current = false;
      setPending(null);
    }
  }

  async function retry(): Promise<void> {
    if (reading) return;
    await read();
  }

  return {
    view,
    /** The value being written, or `null` when no write is in flight. */
    pending,
    failed,
    saved,
    save,
    retry,
    retrying: reading,
  };
}

export type PushSettingsState = ReturnType<typeof usePushSettings>;
