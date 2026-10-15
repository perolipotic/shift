import type { ReactNode } from "react"

// The one empty mark (deferred-work C587): a figure or a name that is not
// there reads as a glyph to the eye and as a word to a screen reader, which
// would otherwise announce "dash" or nothing. The glyph is hidden from
// assistive technology and the word is visually hidden, so neither reader
// gets both. Two slots and no copy: the screen passes both from `t()`.
function EmptyMark({ glyph, word }: { readonly glyph: string; readonly word: string }): ReactNode {
  return (
    <>
      <span aria-hidden>{glyph}</span>
      <span className="sr-only">{word}</span>
    </>
  )
}

export { EmptyMark }
