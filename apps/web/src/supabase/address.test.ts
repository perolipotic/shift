import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADDRESS_DOMAIN,
  INVALID_ORGANIZATION_SLUG,
  INVALID_USERNAME,
  isOrganizationSlug,
  normalizeUsername,
  organizationDestination,
  signInAddress,
} from '@/supabase/address';

/**
 * AD-12's synthesized address, asserted against the two things it must agree
 * with: the seed that already builds it in SQL, and the migration that
 * constrains the slug it is built from.
 *
 * Both are read from disk rather than restated here. A copy of the rule would
 * pass this file and still diverge from the database, which is the only
 * divergence that matters — an address the client builds and the account does
 * not have is a sign-in that fails for every correct credential.
 */

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const SEED = join(repoRoot, 'supabase', 'seed.sql');
const MIGRATION = join(repoRoot, 'supabase', 'migrations', '0002_organizations_and_members.sql');
const PROVISION = join(repoRoot, 'supabase', 'operator', 'provision-organization.sql');

describe('the address is the one the seeded accounts actually carry', () => {
  it('builds username, at sign, slug and the reserved domain', () => {
    expect(signInAddress('ivan.maric', 'dvd-kastel-novi')).toBe(
      'ivan.maric@dvd-kastel-novi.shift.invalid',
    );
  });

  it('namespaces by organization, so one username exists once per tenant', () => {
    // The whole reason the slug rides in the URL: usernames are per-tenant, so
    // the same username in two organizations is two different accounts.
    expect(signInAddress('ana.kovac', 'dvd-kastel-novi')).not.toBe(
      signInAddress('ana.kovac', 'zastita-split'),
    );
  });

  it('agrees with the expression the operator CLI mints the first admin from', () => {
    // The path this file was NOT reading, and the one that matters most: the
    // seed builds the local fixture, but `provision-organization.sql` is what
    // creates the admin of a REAL organization. A divergence here is not a
    // failing test in development, it is an admin who cannot sign in to the
    // tenant that was just provisioned for them, with no other account able to
    // fix it — the one account that exists is the one locked out.
    const provision = readFileSync(PROVISION, 'utf8');

    expect(provision).toContain(
      "admin_username || '@' || organization_slug || '.shift.invalid'",
    );
    // And the same claim executed rather than grepped: the two column values
    // the SQL concatenates, put through this module, produce that string.
    expect(signInAddress('admin', 'novi-tenant')).toBe('admin@novi-tenant.shift.invalid');
  });

  it('agrees with the expression seed.sql builds the accounts from', () => {
    // Vacuous-pass guarded: the concatenation must actually be in the seed, or
    // this assertion proves nothing about what the accounts hold.
    const seed = readFileSync(SEED, 'utf8');

    expect(seed).toContain("username || '@' || fixture_slug || '.shift.invalid'");
    expect(ADDRESS_DOMAIN).toBe('shift.invalid');
  });

  it('uses a domain that can never resolve, so no address is a mailbox', () => {
    // RFC 2606 reserves `.invalid`. These are identifiers; nothing is sent to
    // one, and a typo cannot deliver mail to a real domain.
    expect(signInAddress('ivan.maric', 'dvd-kastel-novi').endsWith('.invalid')).toBe(true);
  });
});

describe('the slug rule is the one the migration declares', () => {
  it('accepts the two seeded slugs', () => {
    expect(isOrganizationSlug('dvd-kastel-novi')).toBe(true);
    expect(isOrganizationSlug('zastita-split')).toBe(true);
    expect(isOrganizationSlug('a')).toBe(true);
    expect(isOrganizationSlug('a1')).toBe(true);
  });

  it('refuses every shape a DNS label may not take', () => {
    expect(isOrganizationSlug('')).toBe(false);
    expect(isOrganizationSlug('-leading')).toBe(false);
    expect(isOrganizationSlug('trailing-')).toBe(false);
    expect(isOrganizationSlug('double--hyphen')).toBe(false);
    expect(isOrganizationSlug('Upper-Case')).toBe(false);
    expect(isOrganizationSlug('under_score')).toBe(false);
    expect(isOrganizationSlug('has space')).toBe(false);
    expect(isOrganizationSlug('dvd.kastel')).toBe(false);
    // The two shapes that would let a caller reach past the address entirely.
    expect(isOrganizationSlug('slug@other')).toBe(false);
    expect(isOrganizationSlug('slug/../other')).toBe(false);
  });

  it('applies the DNS label length limit, which the pattern alone does not', () => {
    expect(isOrganizationSlug('a'.repeat(63))).toBe(true);
    expect(isOrganizationSlug('a'.repeat(64))).toBe(false);
  });

  it('anchors at both ends, so a newline cannot smuggle a second line in', () => {
    // JavaScript's `$` matches only at end of input without the `m` flag, and
    // this is what proves the pattern was not written with it.
    expect(isOrganizationSlug('valid\nnot valid')).toBe(false);
  });

  it('reads the same pattern and limit the migration declares', () => {
    const migration = readFileSync(MIGRATION, 'utf8');

    expect(migration).toContain("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'");
    expect(migration).toContain('length(slug) <= 63');
  });

  it('refuses to build an address from a slug the database would reject', () => {
    // The two rules cannot drift apart silently: an address is unbuildable
    // wherever the column would refuse the value. `Upper-Case` is NOT among
    // these any more — it normalizes to a slug the column accepts, which is the
    // point of `organizationDestination`; what is left is what survives
    // normalization and is still illegal.
    expect(() => signInAddress('ivan.maric', 'Not A Slug')).toThrow(INVALID_ORGANIZATION_SLUG);
    expect(() => signInAddress('ivan.maric', '')).toThrow(INVALID_ORGANIZATION_SLUG);
    expect(() => signInAddress('ivan.maric', 'under_score')).toThrow(INVALID_ORGANIZATION_SLUG);
  });

  it('normalizes a capitalized slug rather than refusing it', () => {
    // `/prijava/DVD-Kastel-Novi` is exactly what the organization prompt would
    // have lowercased, and what a phone's autocapitalization or a shared link
    // produces. Refusing it rendered a working form that refused every correct
    // credential forever, saying the password was wrong.
    expect(signInAddress('ivan.maric', 'DVD-Kastel-Novi')).toBe(
      'ivan.maric@dvd-kastel-novi.shift.invalid',
    );
    expect(signInAddress('ivan.maric', '  dvd-kastel-novi  ')).toBe(
      'ivan.maric@dvd-kastel-novi.shift.invalid',
    );
  });
});

describe('the username half is normalized exactly as far as the slug half is', () => {
  // This module had no username case at all: every assertion above passes an
  // already-perfect `ivan.maric`, so the half of the address a PERSON types was
  // the half nothing exercised.
  it.each([
    ['what the fixture holds', 'ivan.maric', 'ivan.maric'],
    ['a capital, which a phone keyboard adds unasked', 'Ivan.Maric', 'ivan.maric'],
    ['a paste with surrounding whitespace', '  ivan.maric  ', 'ivan.maric'],
    ['a paste that brought a newline', 'ivan.maric\n', 'ivan.maric'],
    ['a tab from a spreadsheet cell', '\tana.kovac\t', 'ana.kovac'],
    ['a name already lowercase and clean', 'ana.kovac', 'ana.kovac'],
  ])('accepts %s', (_case, typed, expected) => {
    expect(normalizeUsername(typed)).toBe(expected);
    expect(signInAddress(typed, 'dvd-kastel-novi')).toBe(
      `${expected}@dvd-kastel-novi.${ADDRESS_DOMAIN}`,
    );
  });

  it.each([
    ['nothing at all', ''],
    ['whitespace only', '   '],
    ['a newline only', '\n'],
    ['an internal space, which no local part may carry', 'ivan maric'],
    ['an internal newline', 'ivan\nmaric'],
    ['an at sign, which would move the address to another domain', 'ivan@example.com'],
    ['a bare at sign', '@'],
  ])('refuses %s, because no account can hold the address it would build', (_case, typed) => {
    expect(normalizeUsername(typed)).toBeNull();
    expect(() => signInAddress(typed, 'dvd-kastel-novi')).toThrow(INVALID_USERNAME);
  });

  it('keeps the two refusals distinguishable to a developer and to nobody else', () => {
    // Different codes here, because this module's caller is code. The SCREEN
    // collapses both into the one refusal message — `sign-in.ts` is where that
    // happens, and it is asserted there.
    expect(INVALID_USERNAME).not.toBe(INVALID_ORGANIZATION_SLUG);
    expect(() => signInAddress('', 'dvd-kastel-novi')).toThrow(INVALID_USERNAME);
    expect(() => signInAddress('ivan.maric', '')).toThrow(INVALID_ORGANIZATION_SLUG);
  });

  it('checks the username before the slug, so neither check masks the other', () => {
    // Both unusable: the first check is the one that reports. Named so the
    // order is a decision rather than an accident of line order.
    expect(() => signInAddress('', '')).toThrow(INVALID_USERNAME);
  });
});

describe('the organization prompt decides where to go, and the decision is executed', () => {
  // Matrix row "Bare /prijava": submitting navigates to /prijava/<slug>, and an
  // unusable value is refused inertly. The screen itself cannot be asserted —
  // AD-15 bans jsdom and `.tsx` is not collected — so the decision was
  // extracted here, the way `i18n/boot.ts` was extracted from `main.tsx`, and
  // this is the case that would have been missing otherwise.
  it.each([
    ['the seeded pilot slug', 'dvd-kastel-novi', 'dvd-kastel-novi'],
    ['surrounding whitespace, which typing produces', '  dvd-kastel-novi  ', 'dvd-kastel-novi'],
    ['capitals, which a shift key produces', 'DVD-Kastel-Novi', 'dvd-kastel-novi'],
    ['a tab and a newline from a paste', '\tzastita-split\n', 'zastita-split'],
  ])('navigates to %s', (_case, typed, expected) => {
    expect(organizationDestination(typed)).toBe(expected);
  });

  it.each([
    ['nothing typed at all', ''],
    ['whitespace only', '   '],
    ['a leading hyphen, which no DNS label may carry', '-leading'],
    ['a trailing hyphen', 'trailing-'],
    ['a doubled hyphen', 'two--hyphens'],
    ['an underscore, which is legal in a host name and not in a label', 'under_score'],
    ['a path separator, which would leave the route', 'a/b'],
    ['a slug one character past the DNS label limit', `${'a'.repeat(64)}`],
  ])('refuses %s inertly, returning null rather than throwing', (_case, typed) => {
    expect(organizationDestination(typed)).toBeNull();
  });

  it('refuses inertly rather than raising, because a message here starts an oracle', () => {
    // The prompt renders no error for a bad slug on purpose: telling somebody
    // that an organization does not exist is the same disclosure the sign-in
    // path refuses to make. A thrown error would force the screen to decide
    // what to say; `null` lets it say nothing.
    expect(() => organizationDestination('-not-a-slug-')).not.toThrow();
  });
});
