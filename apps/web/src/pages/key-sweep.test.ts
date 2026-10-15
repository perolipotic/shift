import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_COPY_KEYS,
  LEAVE_SECTION_KEYS,
  MEMBER_CREATE,
  MEMBER_DIRECTORY,
  MEMBER_EDIT,
  MEMBER_FACTS_KEYS,
  MEMBER_LIST,
  MEMBER_LIST_KEYS,
  MEMBER_WRITE_KEYS,
  RANK_KEYS,
  resourceKeys,
  source,
} from './source-guards.fixture';
import { KEY_SOURCES } from './key-sources.fixture';

// The key sweep: the keys the screens and message modules can put on screen and
// the keys `hr.json` declares are the same set, in both directions.

describe('the keys rendered and the keys declared are the same set', () => {
  /**
   * DEDUPED, which it was not before story 1.3b.
   *
   * `used()` was a sorted concatenation, so a key rendered at two call sites
   * appeared twice and `toEqual` against the declared list failed even though
   * the two SETS were identical — a screen that renders the same message from
   * two branches is an ordinary thing, and the comparison is about sets.
   */
  const used = (): string[] =>
    [...new Set(KEY_SOURCES.flatMap((entry) => entry.keys(source(entry.file))))].sort();

  /**
   * The resource file's screen strings: everything that is not a shared
   * `count.*` plural — except `count.days`, which story 5.1c's leave card is
   * the first screen to render (the allowance, the days used, the balance, the
   * cost and the balance after). `count.conflicts` still waits for its screen.
   */
  const declared = (): string[] =>
    resourceKeys()
      .filter((key) => !key.startsWith('count.') || key === 'count.days')
      .sort();

  it('renders every screen key the resource file declares', () => {
    expect(used()).toEqual(declared());
  });

  it('finds every ljudi key somewhere in the two files that own them, whatever shape it took', () => {
    // THE CATCH-ALL the shape-specific readers cannot be. `memberListKeys` knows
    // two shapes — a `\w*MessageKey` return union and a `label:` entry on the
    // column table — and `translationKeys` knows one, `t('…')`. A key declared
    // any OTHER way (a `Record` literal, a `satisfies`, a third mapping
    // function) is in `hr.json`, renders on screen, and escapes the
    // rendered-versus-declared comparison above entirely, because nothing reads
    // it. This does not care about the shape: every `ljudi.*` key the resource
    // file declares has to appear literally in one of the two files that own
    // this surface, and the comparison above still has to have counted it.
    // FIVE FILES SINCE STORY 1.5b, not two: the `ljudi.form.*` block is rendered
    // by the two member forms and mapped by `@/features/members/services/write`, so a sweep over
    // the list and its rules alone would report every one of those keys as
    // declared and written nowhere — or, worse, would have been narrowed to the
    // `ljudi.` prefix it could still find.
    // SIX SINCE MEMBER RANK: `@/features/members/utils/rank` owns the `ljudi.rank.*` block.
    const owned = [
      MEMBER_LIST,
      MEMBER_LIST_KEYS,
      // STORY 7.17: the member directory's `ljudi.directory.*` block.
      MEMBER_DIRECTORY,
      MEMBER_CREATE,
      MEMBER_EDIT,
      MEMBER_WRITE_KEYS,
      RANK_KEYS,
      // STORY 7.11: the member page header's status badge.
      MEMBER_FACTS_KEYS,
      // STORY 5.1c: `@/features/leave/services/leave-section` maps the leave
      // card's reasons and refusals.
      LEAVE_SECTION_KEYS,
      // STORY 7.8: `Kopiraj`'s two status lines.
      CREDENTIAL_COPY_KEYS,
    ]
      .map((file) => source(file))
      .join('\n');
    const declared = resourceKeys().filter((key) => key.startsWith('ljudi.'));
    // READ ONCE, not once per key: `used()` reads every key source from disk,
    // and asking it again for each of the hundreds of `ljudi.*` keys made this
    // the slowest test in the file — slow enough to time out under load.
    const rendered = used();

    expect(declared.length, 'no ljudi keys to sweep at all').toBeGreaterThan(0);
    for (const key of declared) {
      expect(owned, `${key} is declared in hr.json and written nowhere the readers look`).toContain(
        key,
      );
      expect(
        rendered,
        `${key} is written in the source but no reader here counts it — add its shape to memberListKeys`,
      ).toContain(key);
    }
  });

  it('declares every key the two screens render', () => {
    // The same claim from the other side, and not redundant: `toEqual` on two
    // empty arrays would pass, so this pins both lists non-empty.
    const rendered = used();
    const resource = resourceKeys();

    expect(rendered.length).toBeGreaterThan(0);
    for (const key of rendered) expect(resource).toContain(key);
  });
});
