/**
 * notify — Resend delivery: one email row rendered, posted with the row id as
 * its `Idempotency-Key`, and its answer judged (story 10.1). Split out of
 * `handler.ts` with no change in behaviour (story 12.3b, retro 10).
 *
 * Imports only `handler.ts` and `messages.ts`.
 */

import {
  NETWORK_ERROR,
  PROVIDER_CONFLICT,
  PROVIDER_RATE_LIMITED,
  PROVIDER_REFUSED,
  PROVIDER_STATUS,
  PROVIDER_TIMEOUT,
  PROVIDER_UNAUTHORIZED,
  PROVIDER_UNAVAILABLE,
  RECIPIENT_NO_EMAIL,
  RESEND_ENDPOINT,
  SEND_TIMEOUT_MS,
  type ClaimedNotification,
  type Configuration,
  type Delivery,
  type Fetch,
} from './handler.ts';
import { render } from './messages.ts';

/**
 * A provider answer, as a delivery. 2xx is sent; 401 and 403 stop the run's email;
 * 408, 409, 429 and 5xx retry; any other 4xx is final.
 */
export function deliveryOfStatus(status: number): Delivery {
  if (status >= 200 && status < 300) return { result: 'sent' };
  if (status === 401 || status === 403) return { result: 'stop', failureCode: PROVIDER_UNAUTHORIZED };
  if (status === 408) return { result: 'transient', failureCode: PROVIDER_TIMEOUT };
  if (status === 409) return { result: 'transient', failureCode: PROVIDER_CONFLICT };
  if (status === 429) return { result: 'transient', failureCode: PROVIDER_RATE_LIMITED };
  if (status >= 400 && status < 500) return { result: 'permanent', failureCode: PROVIDER_REFUSED };
  return { result: 'transient', failureCode: PROVIDER_UNAVAILABLE };
}

export async function deliverEmail(row: ClaimedNotification, configuration: Configuration, fetch: Fetch): Promise<Delivery> {
  const address = (row.email ?? '').trim();
  if (address === '') return { result: 'permanent', failureCode: RECIPIENT_NO_EMAIL };

  // TRANSIENT, not permanent: a code this deployment cannot render yet is
  // most likely one a newer migration writes before the newer function is
  // deployed. The backoff gives the deploy time; five misses fail the row.
  const rendered = render(row.code, row.locale, row.operands, {
    appUrl: configuration.appUrl,
    slug: row.slug,
    organizationName: row.organization_name,
  });
  if (!rendered.ok) return { result: 'transient', failureCode: rendered.code };

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configuration.resendApiKey}`,
        'Content-Type': 'application/json',
        // The row id: Resend answers a repeat within 24 hours with the first
        // send's result and sends nothing. Five attempts, with the leases and
        // the backoff between them, stay well inside that window, which is
        // what makes a re-claim after a crash safe.
        'Idempotency-Key': row.id,
      },
      body: JSON.stringify({
        from: configuration.emailFrom,
        to: [address],
        subject: rendered.subject,
        text: rendered.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return { result: 'transient', failureCode: NETWORK_ERROR };
  }

  // The body is never read: it may echo the address, and the status decides.
  await response.body?.cancel().catch(() => undefined);

  if (response.status < 200 || response.status >= 300) {
    console.error(PROVIDER_STATUS, row.id, response.status);
  }

  return deliveryOfStatus(response.status);
}
