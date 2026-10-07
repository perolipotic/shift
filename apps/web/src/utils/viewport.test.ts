import { describe, expect, it, vi } from 'vitest';

import { PHONE_MEDIA_QUERY, WIDE_QUERY, phoneStoreOf, type PhoneMediaQuery } from '@/utils/viewport';

describe('the one breakpoint (story 7.5)', () => {
  it("is Tailwind's sm: a phone is below 640 px, wide is 640 px and up", () => {
    expect(PHONE_MEDIA_QUERY).toBe('(max-width: 639px)');
    expect(WIDE_QUERY).toBe('(min-width: 640px)');
  });

  it('follows the width through one shared media query list', () => {
    const listeners = new Set<() => void>();
    const asked: string[] = [];
    const list: PhoneMediaQuery & { matches: boolean } = {
      matches: false,
      addEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.delete(listener);
      }),
    };
    const store = phoneStoreOf((query) => {
      asked.push(query);

      return list;
    });

    expect(asked).toEqual([]);
    expect(store.get()).toBe(false);
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);

    expect(list.addEventListener).toHaveBeenCalledWith('change', onChange);
    list.matches = true;
    for (const listener of listeners) listener();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(true);
    unsubscribe();
    expect(list.removeEventListener).toHaveBeenCalledWith('change', onChange);
    expect(listeners.size).toBe(0);
    expect(asked).toEqual([PHONE_MEDIA_QUERY]);
  });
});
