import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  MEMBERS_TABLE,
  NOTIFICATION_SETTINGS_KEY,
  NOTIFICATION_SETTINGS_TABLE,
  ORGANIZATIONS_TABLE,
  NOTIFICATION_SETTINGS_UNAVAILABLE,
  notificationsViewOf,
  readNotificationSettings,
  writeEmailSetting,
  type NotificationSettingsOutcome,
  type NotificationTables,
  type OneKeyTable,
  type SettingsTable,
} from '@/features/notifications/services/settings';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { currentSession, supabaseClient } from '@/lib/supabase/client';

/**
 * The three tables, built inside a query or write function, never at render.
 * Narrowed to the structural slices the service calls, as the hour bands'
 * write table is: postgrest-js's own builder types are too deep to check
 * against them.
 */
function tables(): NotificationTables {
  const client = supabaseClient();
  return {
    members: () => client.from(MEMBERS_TABLE) as unknown as OneKeyTable,
    settings: () => client.from(NOTIFICATION_SETTINGS_TABLE) as unknown as SettingsTable,
    organizations: () => client.from(ORGANIZATIONS_TABLE) as unknown as OneKeyTable,
  };
}

/**
 * `/obavijesti`'s read and its one write (story 10.3).
 *
 * THE CONTROL SAVES AT ONCE, as a choice made, with no Spremi: while the
 * write is in flight it is `pending` (the control disabled, `aria-busy`), and
 * the chosen value is drawn. A refusal or a fault draws the stored value
 * again with the failure notice; the member retries by choosing again. A
 * landed write sets the cache to what the database answered and says so.
 * Offline nothing is sent (the write gate's note says why).
 */
export function useNotificationSettings() {
  const queryClient = useQueryClient();
  const read = useQuery({
    queryKey: NOTIFICATION_SETTINGS_KEY,
    queryFn: () => readNotificationSettings(tables(), currentSession),
    retry: false,
  });

  const saving = useRef(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);

  const outcome = read.data;
  const view = notificationsViewOf(read.isError ? { ok: false, code: NOTIFICATION_SETTINGS_UNAVAILABLE } : outcome);

  async function save(email: boolean): Promise<void> {
    if (saving.current || outcome === undefined || !outcome.ok) return;
    if (!writesOnline()) return;
    if (email === outcome.settings.email) return;

    saving.current = true;
    setPending(email);
    setFailed(false);
    setSaved(null);

    try {
      const written = await writeEmailSetting(tables(), outcome.settings, email);

      if (!written.ok) {
        setFailed(true);
        return;
      }

      const landed: NotificationSettingsOutcome = {
        ok: true,
        settings: { ...outcome.settings, email: written.email },
      };
      queryClient.setQueryData(NOTIFICATION_SETTINGS_KEY, landed);
      setSaved(written.email);
    } finally {
      saving.current = false;
      setPending(null);
    }
  }

  async function retry(): Promise<void> {
    if (read.isFetching) return;
    await read.refetch();
  }

  return {
    view,
    /** The value being written, or `null` when no write is in flight. */
    pending,
    failed,
    saved,
    save,
    retry,
    retrying: read.isFetching,
  };
}

export type NotificationSettingsState = ReturnType<typeof useNotificationSettings>;
