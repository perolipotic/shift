/**
 * What the session's own access token claims, read without a query.
 *
 * Lives beside the client rather than in a feature because every admin write
 * surface needs it (teams, shift types, hour bands, rotation, the calendar's
 * roster and override dialogs), and it is a fact about the SESSION, not about
 * any of them. It used to sit in `features/teams/services/write.ts`, which made
 * five features import the teams feature for a token parser (C488).
 */

/**
 * The organization the caller's token names, or `null`.
 *
 * READ FROM THE SESSION'S OWN CLAIM rather than a second query, so a list
 * screen keeps its one read (AD-13). It is not trusted: every insert policy
 * pins the tenant from the same signed claim and from the fresh helper, so a
 * wrong value here is refused by the database, never written.
 */
export function claimedOrganizationOf(accessToken: string | null | undefined): string | null {
  if (typeof accessToken !== 'string') return null;

  const payload = accessToken.split('.')[1];

  if (payload === undefined || payload === '') return null;

  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
    const decoded: unknown = JSON.parse(atob(base64));

    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;

    const claim = (decoded as Record<string, unknown>)['organization_id'];

    return typeof claim === 'string' && claim !== '' ? claim : null;
  } catch {
    return null;
  }
}
