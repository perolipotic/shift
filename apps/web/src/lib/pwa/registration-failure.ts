/**
 * Logged with the cause when the service worker fails to register (story 8.1,
 * `components/update-notice.tsx`). A stable code, never shown: without a worker
 * the app works as it did before, so the member is told nothing.
 */
export const SERVICE_WORKER_REGISTRATION_FAILED = 'SERVICE_WORKER_REGISTRATION_FAILED';

/** Reports a failed registration to the console under {@link SERVICE_WORKER_REGISTRATION_FAILED}. */
export function reportRegistrationFailure(cause: unknown): void {
  console.warn(SERVICE_WORKER_REGISTRATION_FAILED, cause);
}

/** Logged with the cause when a resume-time check for a new worker fails. */
export const SERVICE_WORKER_UPDATE_CHECK_FAILED = 'SERVICE_WORKER_UPDATE_CHECK_FAILED';

/** Reports a failed update check to the console under {@link SERVICE_WORKER_UPDATE_CHECK_FAILED}. */
export function reportUpdateCheckFailure(cause: unknown): void {
  console.warn(SERVICE_WORKER_UPDATE_CHECK_FAILED, cause);
}
