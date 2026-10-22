import { describe, expect, it } from 'vitest';

import { writeGateOf } from '@/lib/offline/use-write-gate';

/** Story 8.3a's write gate, executed with no browser (AD-15). */
describe('writeGateOf', () => {
  it('online, lets the control write and adds nothing to it', () => {
    const gate = writeGateOf(true, 'note');

    expect(gate.online).toBe(true);
    expect(gate.disabled).toBeUndefined();
    expect(gate.describedBy()).toBeUndefined();
    expect(gate.describedBy('hint', null, undefined, false)).toBe('hint');
  });

  it('offline, marks the control aria-disabled and names the note after its own ids', () => {
    const gate = writeGateOf(false, 'note');

    expect(gate.online).toBe(false);
    expect(gate.disabled).toBe(true);
    expect(gate.describedBy()).toBe('note');
    expect(gate.describedBy('hint', null, 'error')).toBe('hint error note');
  });

  it('keeps the note id it was given', () => {
    expect(writeGateOf(false, 'offline-write-x').noteId).toBe('offline-write-x');
  });
});
