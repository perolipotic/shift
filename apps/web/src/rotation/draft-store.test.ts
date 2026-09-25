import { describe, expect, it } from 'vitest';

import { withStepAdded, withTeamStep, prefillOf } from '@/rotation/draft';
import {
  createDraftStore,
  createPreviewCyclesStore,
  rotationDraftStore,
  shownDraftOf,
} from '@/rotation/draft-store';
import { readRotation, type RotationSnapshot } from '@/rotation/list';
import {
  OTHER_ORGANIZATION,
  PILOT,
  TODAY,
  answerOf,
  teamRow,
  typeRow,
  type FixtureRows,
} from '@/rotation/rotation.fixture';

/**
 * The unsaved draft's store (story 2.3b, as renegotiated): kept outside the
 * component so the shift type dialog's remount does not lose it, reset after
 * a landed save, and always shown re-normalized against the snapshot.
 */

async function snapshotOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation({ select: () => Promise.resolve(answerOf(rows)) });

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

describe('the draft store', () => {
  it('holds nothing at first, keeps an edit, and tells every subscriber', () => {
    const store = createDraftStore();
    const heard: string[] = [];
    const unsubscribe = store.subscribe(() => heard.push('one'));

    store.subscribe(() => heard.push('two'));
    expect(store.get()).toBeNull();

    const draft = { steps: ['a'], anchorDate: TODAY, offsets: {}, keys: ['step-0'], nextKey: 1 };

    store.set('org', draft);
    expect(store.get()).toEqual({ organizationId: 'org', draft });
    expect(heard).toEqual(['one', 'two']);

    unsubscribe();
    store.reset();
    expect(store.get()).toBeNull();
    expect(heard).toEqual(['one', 'two', 'two']);
  });

  it('says nothing when a reset finds nothing to forget, so a render is not asked for twice', () => {
    const store = createDraftStore();
    let heard = 0;

    store.subscribe(() => {
      heard += 1;
    });
    store.reset();
    expect(heard).toBe(0);
  });

  it('keeps one store for the tab, which a remounted builder reads back', async () => {
    const snapshot = await snapshotOf(PILOT);
    const edited = withStepAdded(prefillOf(snapshot, TODAY), 'pilot-dan');

    rotationDraftStore.set(snapshot.organizationId, edited);
    // A new mount reads the same store: the edit is there.
    expect(shownDraftOf(rotationDraftStore.get(), snapshot, TODAY)).toEqual(edited);
    rotationDraftStore.reset();
    expect(shownDraftOf(rotationDraftStore.get(), snapshot, TODAY)).toEqual(prefillOf(snapshot, TODAY));
  });
});

describe('the draft shown', () => {
  it('is the prefill with nothing stored, and after a reset', async () => {
    const snapshot = await snapshotOf(PILOT);

    expect(shownDraftOf(null, snapshot, TODAY)).toEqual(prefillOf(snapshot, TODAY));
  });

  it("is never another organization's edit", async () => {
    const snapshot = await snapshotOf(PILOT);
    const edited = withStepAdded(prefillOf(snapshot, TODAY), 'pilot-dan');

    expect(shownDraftOf({ organizationId: OTHER_ORGANIZATION, draft: edited }, snapshot, TODAY)).toEqual(
      prefillOf(snapshot, TODAY),
    );
  });

  it('re-normalizes a kept edit against a refetched snapshot: a new team on step 1, an archived one gone', async () => {
    const before = await snapshotOf(PILOT);
    const edited = withTeamStep(prefillOf(before, TODAY), 'pilot-smjena-d', 1);
    const after = await snapshotOf({
      ...PILOT,
      teams: [
        ...PILOT.teams.map((row) => (row['id'] === 'pilot-smjena-a' ? { ...row, archived: true } : row)),
        teamRow('new', 'Smjena E'),
      ],
      types: [...PILOT.types, typeRow('pilot-dezurstvo', 'Dežurstvo', '2026-09-25T21:00:00+00:00')],
    });
    const shown = shownDraftOf({ organizationId: after.organizationId, draft: edited }, after, TODAY);

    expect(shown.steps).toEqual(edited.steps);
    expect(shown.keys).toEqual(edited.keys);
    expect(shown.offsets).toEqual({
      'pilot-smjena-b': 1,
      'pilot-smjena-c': 2,
      'pilot-smjena-d': 1,
      new: 0,
    });
  });
});

describe('the preview cycles choice', () => {
  it('starts at one cycle, keeps a valid choice, reads anything else as one, and tells subscribers only of a change', () => {
    const store = createPreviewCyclesStore();
    let heard = 0;

    store.subscribe(() => {
      heard += 1;
    });
    expect(store.get()).toBe(1);
    store.set('3');
    expect(store.get()).toBe(3);
    store.set(3);
    expect(heard).toBe(1);
    store.set('7');
    expect(store.get()).toBe(1);
    expect(heard).toBe(2);
  });
});
