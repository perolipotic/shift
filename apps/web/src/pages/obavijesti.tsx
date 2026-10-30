import { createRoute } from '@tanstack/react-router';

import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { NotificationSettingsCard } from '@/features/notifications/components/notification-settings-card';
import { PushSettingsCard } from '@/features/notifications/components/push-settings-card';
import { useNotificationSettings } from '@/features/notifications/hooks/use-notification-settings';
import { usePushSettings } from '@/features/notifications/hooks/use-push-settings';
import { NOTIFICATIONS_HEADING_ID } from '@/features/notifications/utils/element-ids';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/obavijesti` — *Obavijesti* (story 10.3): the signed-in person's own
 * notification settings, for every role. Reached from a fixed row in *Više*
 * and in the desktop profile menu, never a destination. It holds two
 * independent sections: email (`useNotificationSettings`, the rules
 * `@/features/notifications/services/settings`) and, from story 10.4, this
 * device's push (`usePushSettings`, the rules
 * `@/features/notifications/services/push`). The session guard is the
 * `_app` layout's.
 */
export function ObavijestiScreen() {
  const state = useNotificationSettings();
  const push = usePushSettings();

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6"
      aria-labelledby={NOTIFICATIONS_HEADING_ID}
    >
      <PageHeader>
        <div className="grid min-w-0 gap-1">
          <PageTitle asChild>
            <h1 id={NOTIFICATIONS_HEADING_ID}>{t('postavkeObavijesti.heading')}</h1>
          </PageTitle>
        </div>
      </PageHeader>
      <NotificationSettingsCard state={state} />
      <PushSettingsCard state={push} />
    </main>
  );
}

export const obavijestiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/obavijesti',
  component: ObavijestiScreen,
});
