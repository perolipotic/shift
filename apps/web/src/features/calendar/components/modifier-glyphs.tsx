import { Fragment, type ReactNode } from 'react';

import { GLYPH_TEXT, type ModifierGlyph } from '@/features/calendar/utils/modifiers';

/**
 * A run of modifier glyphs, in the order given (story 5.3c): a text glyph as
 * its character, an icon as its lucide component sized to the text — both
 * `aria-hidden`, in `currentColor`, the cell's or the legend swatch's own
 * foreground. The label beside them carries the meaning.
 */
export function ModifierGlyphs({ glyphs }: { readonly glyphs: readonly ModifierGlyph[] }): ReactNode {
  return (
    <span aria-hidden className="inline-flex items-center gap-0.5 font-normal [font-variant-emoji:text]">
      {glyphs.map((glyph, index) =>
        glyph.kind === GLYPH_TEXT ? (
          <Fragment key={index}>{glyph.text}</Fragment>
        ) : (
          <glyph.icon key={index} aria-hidden className="size-3 shrink-0" strokeWidth={2.5} />
        ),
      )}
    </span>
  );
}
