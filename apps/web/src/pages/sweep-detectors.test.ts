import { describe, expect, it } from 'vitest';

import {
  ariaCurrentValues,
  attributeOf,
  bareInputElements,
  buttonElements,
  componentFunction,
  describedByIds,
  finallyBlock,
  headingKey,
  heightPx,
  idTokens,
  inputElements,
  jsxTextWithContent,
  labelTargets,
  linkElements,
  memberListKeys,
  memberWriteKeys,
  messageKeyUnion,
  navBlocks,
  resourceKeys,
  stripComments,
  stripTypeArguments,
  STRUCTURAL_ATTRIBUTES,
  STRUCTURAL_EXPRESSION_ATTRIBUTES,
  submitHandler,
  TARGET_FLOOR_PX,
  templateStaticText,
  translationKeys,
  unsanctionedLiterals,
} from './source-guards.fixture';

// The detectors every source guard relies on, self-tested on synthetic sources so a
// regex that stopped matching cannot make a sweep pass having proved nothing.

describe('the detectors find what they claim to find', () => {
  // Synthetic sources, so each regex is proved on the shape it exists to catch
  // rather than on the one file that happens to be compliant today.
  const compliant = [
    'export function Probe() {',
    '  return (',
    '    <p className="text-sm">{t(\'auth.heading\')}</p>',
    '  );',
    '}',
  ].join('\n');
  const withText = compliant.replace(">{t('auth.heading')}<", '>Prijava<');
  const withLiteral = compliant.replace('className="text-sm"', 'aria-label="Zatvori"');
  const withTemplate = compliant.replace("{t('auth.heading')}", '{`Prijava`}');

  it('reads a key out of a t() call and finds none where there is none', () => {
    expect(translationKeys(compliant)).toEqual(['auth.heading']);
    expect(translationKeys('const x = 1;')).toEqual([]);
  });

  it('reports bare JSX text and stays silent on an expression container', () => {
    expect(jsxTextWithContent(withText)).toEqual(['Prijava']);
    expect(jsxTextWithContent(compliant)).toEqual([]);
  });

  it('reports a literal on a non-structural attribute and allows className', () => {
    expect(unsanctionedLiterals(withLiteral)).toEqual(['Zatvori']);
    expect(unsanctionedLiterals(compliant)).toEqual([]);
  });

  it('allows a structural attribute written as an expression, and only those', () => {
    // The widening the conditional description needed, on BOTH polarities. The
    // first shape is what the screen ships; the second is the shape that must
    // keep firing, and it differs only in the attribute's name.
    expect(
      unsanctionedLiterals("<Input aria-describedby={f === null ? undefined : 'sign-in-error'} />"),
    ).toEqual([]);
    expect(unsanctionedLiterals("<Input aria-label={f === null ? undefined : 'Zatvori'} />")).toEqual(
      ['Zatvori'],
    );
    // A nested container is not matched, so nothing hides inside one.
    expect(unsanctionedLiterals("<p className={cn({ a: 'Danas' })} />")).toEqual(['Danas']);
  });

  it('exempts the expression form only for the named subset, not the whole allowlist', () => {
    // `role` is on the allowlist for its QUOTED form. Generated from the whole
    // set, the expression matcher exempted it braced too, with no review of its
    // own; the subset is what makes the next entry a second decision.
    expect(STRUCTURAL_EXPRESSION_ATTRIBUTES.every((name) => STRUCTURAL_ATTRIBUTES.has(name))).toBe(true);
    expect(STRUCTURAL_EXPRESSION_ATTRIBUTES).not.toContain('role');
    expect(unsanctionedLiterals('<div role="alert" />')).toEqual([]);
    expect(unsanctionedLiterals("<div role={f ? 'alert' : 'Zatvori'} />")).toEqual(['alert', 'Zatvori']);
  });

  it('reports a template literal, which the quote-only class could not see', () => {
    expect(unsanctionedLiterals(withTemplate)).toEqual(['Prijava']);
  });

  it('allows a template that interpolates a value and holds no text of its own', () => {
    expect(unsanctionedLiterals('const label = `${n}`;')).toEqual([]);
    expect(templateStaticText('${n} dana')).toBe(' dana');
  });

  it('does not mistake an arrow function body for JSX text', () => {
    // Without the `=>` substitution this reports ` handler() ` as user-facing
    // text, and the sweep becomes a rule people work around.
    expect(jsxTextWithContent('const f = () => handler();')).toEqual([]);
  });

  it('does not mistake a type-argument list for JSX text', () => {
    // The false positive story 1.3b's refs and state hooks produced. All four
    // shapes are in the sign-in screen today.
    expect(jsxTextWithContent('const a = useRef<HTMLInputElement>(null); const b = f<T>(x);')).toEqual(
      [],
    );
    expect(jsxTextWithContent('function s(e: FormEvent<HTMLFormElement>): Promise<void> {}')).toEqual(
      [],
    );
    expect(stripTypeArguments('useState<Record<string, string>>(x)')).toBe('useState(x)');
    expect(stripTypeArguments('useState<A | null>(x)')).toBe('useState(x)');
  });

  it('still reports bare text once type arguments are neutralized', () => {
    // BOTH polarities, because a substitution that ate JSX would make every
    // text sweep in this file pass on any screen at all. A tag's `<` follows
    // whitespace, `(`, `{` or `>` — never an identifier character.
    expect(jsxTextWithContent('<p>Prijava</p>')).toEqual(['Prijava']);
    expect(stripTypeArguments('<Input id="a" />')).toBe('<Input id="a" />');
    expect(stripTypeArguments('<p>Prijava</p>')).toBe('<p>Prijava</p>');
  });

  it('records where the type-argument strip over-reaches into JSX', () => {
    // The polarity the two self-tests above miss, and it is a real one: they
    // only ever put a CLOSING tag after the text, and `</p>` is excluded by the
    // character class because of the `/`. An OPENING tag after text is not —
    // `Prijava<span>` puts `<` directly after an identifier character, which is
    // exactly the lookbehind's condition, so the strip eats `<span>` and merges
    // two runs into one.
    //
    // Asserted as it BEHAVES rather than as it should behave, because the
    // imprecision loses no literal: the merged run is still reported, so the
    // sweep still fails on hard-coded text. Written down so the next person to
    // widen this regex sees the boundary rather than discovering it.
    expect(stripTypeArguments('<p>Prijava<span>x</span></p>')).toBe('<p>Prijavax</span></p>');
    expect(jsxTextWithContent('<p>Prijava<span>x</span></p>')).toEqual(['Prijavax']);
  });

  it('binds a form to its own handler and refuses one that is merely nearby', () => {
    // The matcher that replaced the deleted `onSubmit` regex got no self-test,
    // and its 160-character window was an unasserted magic bound. Both
    // polarities: a binding inside the window is found, and a `submit` that is
    // only mentioned far away from the attribute is not.
    expect('<form onSubmit={(e) => { void submit(e); }}>').toMatch(
      /onSubmit=\{[\s\S]{0,160}?\bsubmit\b/,
    );
    expect('<form onSubmit={noop}>').not.toMatch(/onSubmit=\{[\s\S]{0,160}?\bsubmit\b/);
    expect(`<form onSubmit={noop}>${' '.repeat(200)}submit`).not.toMatch(
      /onSubmit=\{[\s\S]{0,160}?\bsubmit\b/,
    );
  });

  it('extracts a handler and its finally rather than matching the file', () => {
    const screen = [
      'export function Probe() {',
      '  async function submit(event) {',
      '    try {',
      '      await navigate({ to: 1 });',
      '    } finally {',
      '      setPending(false);',
      '    }',
      '  }',
      '}',
      'function elsewhere() { setPending(true); }',
    ].join('\n');

    expect(submitHandler(screen)).toContain('navigate({ to: 1 })');
    expect(submitHandler(screen), 'the extraction ran past the handler').not.toContain('elsewhere');
    expect(finallyBlock(screen)).toContain('setPending(false)');
    expect(finallyBlock('function submit() { const x = 1; }')).toBe('');
    expect(submitHandler('const noHandlerHere = 1;')).toBe('');
  });

  it('reads a height off every class shape and nothing off none', () => {
    expect(heightPx('h-11 w-full')).toBe(44);
    expect(heightPx('h-9')).toBe(36);
    expect(heightPx('min-h-12')).toBe(48);
    expect(heightPx('h-[44px]')).toBe(44);
    expect(heightPx('h-[2.75rem]')).toBe(44);
    // `h-full` and `h-auto` prove no pixel height, and neither does a class
    // that merely starts with the same letters.
    expect(heightPx('h-full')).toBeNull();
    expect(heightPx('w-full items-center')).toBeNull();
    expect(heightPx(null)).toBeNull();
  });

  it('would refuse the mutation that deleted the height classes', () => {
    // The gap this block exists for, proved on the mutated shape rather than
    // only on the compliant one.
    expect(heightPx('h-9')).toBeLessThan(TARGET_FLOOR_PX);
  });

  it('strips comments before scanning, in both syntaxes', () => {
    expect(stripComments('/* Prijava */ const x = 1;').trim()).toBe('const x = 1;');
    expect(stripComments('const x = 1; // Prijava').trim()).toBe('const x = 1;');
  });

  it('reads an attribute value and finds none where the attribute is absent', () => {
    expect(attributeOf('id="username" type="text"', 'id')).toBe('username');
    expect(attributeOf('id="username" type="text"', 'placeholder')).toBeNull();
  });

  it('allows a variant and still refuses the attribute next to it', () => {
    // The entry story 1.4a added to the allowlist, proved on BOTH polarities.
    // Widening the set is the one edit to this file that can quietly stop it
    // catching things, so the neighbouring offence has to still be caught.
    expect(unsanctionedLiterals('<Button variant="outline">{t(\'organization.save\')}</Button>')).toEqual(
      [],
    );
    expect(unsanctionedLiterals('<Button variant="outline" title="Spremi" />')).toEqual(['Spremi']);
  });

  it('allows a variant only on the primitives whose variant is a closed set', () => {
    // Scoped to `VARIANT_COMPONENTS` rather than the global allowlist, so a
    // `variant` on any other element is read like any other attribute.
    expect(STRUCTURAL_ATTRIBUTES.has('variant')).toBe(false);
    expect(unsanctionedLiterals("<Button variant={f ? 'outline' : 'ghost'} />")).toEqual([]);
    expect(unsanctionedLiterals('<Badge variant="secondary">{t(\'a.b\')}</Badge>')).toEqual([]);
    expect(unsanctionedLiterals('<Card variant="Spremi" />')).toEqual(['Spremi']);
    // The nearest opening tag decides, so an arrow in an earlier attribute
    // does not hand a later element the button's exemption.
    expect(
      unsanctionedLiterals('<Button onClick={() => go()} variant="ghost" /><Card variant="Danas" />'),
    ).toEqual(['Danas']);
  });

  it('reads a message-key union off either mapping, not only the first one', () => {
    // The generalization story 1.4a needed. A reader pinned to
    // `signInMessageKey` returns nothing for `organizationMessageKey`, which
    // drops four keys out of the rendered set and makes the set comparison
    // quietly weaker by four rather than red.
    const signature = [
      'export function organizationMessageKey(',
      '  failure: OrganizationFailure,',
      "): 'organization.error.refused' | 'organization.error.name' {",
      '  return failure === ORGANIZATION_REFUSED',
      '}',
    ].join('\n');

    expect(messageKeyUnion(signature)).toEqual([
      'organization.error.refused',
      'organization.error.name',
    ]);
  });

  it('allows a role and still refuses the attribute next to it', () => {
    // The entry story 1.3b added to the allowlist, proved on BOTH polarities:
    // widening the set is the one edit to this file that can quietly stop it
    // catching things, so the neighbouring offence has to still be caught.
    expect(unsanctionedLiterals('<p role="alert">{t(\'auth.heading\')}</p>')).toEqual([]);
    expect(unsanctionedLiterals('<p role="alert" aria-label="Greška" />')).toEqual(['Greška']);
  });

  it('reads describedby ids out of a literal and out of a conditional', () => {
    // The matcher loosened for the conditional attribute, on both polarities.
    // A version that saw only the literal form returns nothing for the shape
    // the screen actually ships, and every id assertion above passes vacuously.
    expect(describedByIds('id="a" aria-describedby="one two"')).toEqual(['one', 'two']);
    expect(
      describedByIds("id=\"a\" aria-describedby={f === null ? 'password-reset' : 'sign-in-error password-reset'}"),
    ).toEqual(['password-reset', 'sign-in-error', 'password-reset']);
    expect(describedByIds("aria-describedby={f === null ? undefined : 'sign-in-error'}")).toEqual([
      'sign-in-error',
    ]);
    expect(describedByIds('id="a" type="text"')).toEqual([]);
  });

  it('splits an aria-describedby token list and finds no id in nothing', () => {
    // The matcher loosened for the refusal message. A version that returned the
    // whole value as one token would look up an id no element can carry, and a
    // version that returned `['']` would "find" `id=\"\"` in any file.
    expect(idTokens('sign-in-error password-reset')).toEqual(['sign-in-error', 'password-reset']);
    expect(idTokens('  spaced   out  ')).toEqual(['spaced', 'out']);
    expect(idTokens('single')).toEqual(['single']);
    expect(idTokens(null)).toEqual([]);
    expect(idTokens('')).toEqual([]);
  });

  it('would report a key rendered twice once, which is what the set claim means', () => {
    // The dedupe `used()` gained. Without it a screen that renders one message
    // from two branches fails the set comparison while the two sets are equal.
    const twice = "{t('auth.heading')}{t('auth.heading')}";

    expect(translationKeys(twice)).toEqual(['auth.heading', 'auth.heading']);
    expect([...new Set(translationKeys(twice))]).toEqual(['auth.heading']);
  });

  it('finds every self-closing Input and nothing where there is none', () => {
    const two = '<Input id="a" /><p>text</p><Input id="b" className="h-11" />';

    expect(inputElements(two)).toEqual([' id="a" ', ' id="b" className="h-11" ']);
    expect(inputElements('<p>no inputs here</p>')).toEqual([]);
  });

  it('finds a bare input and never the shadcn primitive, which is a different control', () => {
    // BOTH polarities. A detector that also matched `<Input>` would report the
    // five settings fields as file pickers and make the single-picker assertion
    // fail on correct code; one that matched neither would make every claim
    // about the picker pass against an empty string.
    const mixed = '<Input id="a" className="h-11" /><input id="b" type="file" />';

    expect(bareInputElements(mixed)).toEqual([' id="b" type="file" ']);
    expect(bareInputElements('<Input id="a" />')).toEqual([]);
    expect(bareInputElements('<p>no inputs here</p>')).toEqual([]);
  });

  it('finds every Button, self-closing or not, and nothing where there is none', () => {
    const two = '<Button type="submit">Go</Button><Button className="h-11" disabled />';

    expect(buttonElements(two)).toEqual([' type="submit"', ' className="h-11" disabled ']);
    expect(buttonElements('<p>no buttons here</p>')).toEqual([]);
  });

  it('finds every Link and never a Label, which starts the same way', () => {
    // BOTH polarities, and the near-miss is the point: `<Label` shares four
    // characters with `<Link`, and a detector without the word boundary would
    // report the settings surface's five labels as navigation links and measure
    // them against a floor they are not controls for. One that matched neither
    // would make every claim about the chrome pass against an empty list.
    const mixed = '<Link to="/danas" className="h-11">x</Link><Label htmlFor="a" />';

    expect(linkElements(mixed)).toEqual([' to="/danas" className="h-11"']);
    expect(linkElements('<Label htmlFor="a" />')).toEqual([]);
    expect(linkElements('<p>no links here</p>')).toEqual([]);
  });

  it('allows aria-current and still refuses the attribute next to it', () => {
    // The entry the navigation chrome added to the allowlist, proved on BOTH
    // polarities. Widening that set is the one edit to this file that can
    // quietly stop it catching things, so the neighbouring offence has to still
    // be caught — in the quoted form and in the expression form, since the
    // active treatment ships as the latter.
    expect(unsanctionedLiterals('<Link aria-current="page">{t(\'nav.danas\')}</Link>')).toEqual([]);
    expect(
      unsanctionedLiterals("<Link aria-current={active ? 'page' : undefined} to={path} />"),
    ).toEqual([]);
    expect(unsanctionedLiterals('<Link aria-current="page" title="Danas" />')).toEqual(['Danas']);
    expect(
      unsanctionedLiterals("<Link aria-current={active ? 'page' : undefined} alt='Danas' />"),
    ).toEqual(['Danas']);
  });

  it('extracts each nav block and never merges two into one', () => {
    // BOTH polarities. A version that matched greedily would return ONE block
    // spanning both bars, and "every bar renders the exit" would then be
    // satisfied by one bar that does — which is exactly the mutation the sweep
    // exists to catch. One that matched nothing would make the same sweep pass
    // against an empty list.
    const two = '<nav id="a">{destinations}</nav><p>x</p><nav id="b">{exit}</nav>';

    expect(navBlocks(two)).toEqual(['<nav id="a">{destinations}</nav>', '<nav id="b">{exit}</nav>']);
    expect(navBlocks('<p>no navigation here</p>')).toEqual([]);
  });

  it('reads aria-current values out of both syntaxes and none out of neither', () => {
    // The sweep that keeps the allowlist exemption honest is only as good as
    // this reader: one that returned nothing would let `aria-current="Danas"`
    // through on every screen in the application.
    expect(ariaCurrentValues('<Link aria-current="page" />')).toEqual(['page']);
    expect(ariaCurrentValues("<Link aria-current={a ? 'page' : undefined} />")).toEqual(['page']);
    expect(ariaCurrentValues('<Link aria-current="Danas" />')).toEqual(['Danas']);
    expect(ariaCurrentValues("<Link aria-current={a ? 'step' : 'page'} />")).toEqual(['step', 'page']);
    expect(ariaCurrentValues('<Link to="/danas" />')).toEqual([]);
  });

  it('allows aria-controls and still refuses the attribute next to it', () => {
    // The second entry the chrome added to the allowlist, proved on both
    // polarities. It is an id reference list exactly as `aria-describedby` is,
    // and the neighbouring offence has to keep firing.
    expect(unsanctionedLiterals('<Button aria-controls="app-destinations" />')).toEqual([]);
    expect(unsanctionedLiterals('<Button aria-controls="app-destinations" title="Izbornik" />')).toEqual(
      ['Izbornik'],
    );
  });

  it('extracts a component helper and stops at its own closing brace', () => {
    // The extraction the 1.4a review needed, on both polarities: a version that
    // ran past the function would swallow the component's own return and make
    // "the alert is not inside it" false on correct code, and one that matched
    // nothing would make the same assertion pass on the broken code.
    const component = [
      'export function Probe() {',
      '  function renderSettings() {',
      '    return <div className="animate-pulse" />;',
      '  }',
      '',
      '  return <p role="alert">x</p>;',
      '}',
    ].join('\n');

    expect(componentFunction(component, 'renderSettings')).toContain('animate-pulse');
    expect(
      componentFunction(component, 'renderSettings'),
      'the extraction ran past the helper',
    ).not.toContain('role="alert"');
    expect(componentFunction(component, 'missing')).toBe('');
  });

  it('reads the heading key off an h1, on one line or three', () => {
    // Both polarities and both layouts. A reader that returned `null` for the
    // multi-line form would make the destination-binding assertion fail on a
    // correct screen; one that returned the first key in the file would make it
    // pass on a screen titled by the wrong one.
    expect(headingKey('<h1 className="x">{t(\'nav.danas\')}</h1>')).toBe('nav.danas');
    expect(
      headingKey('<h1 className="x">\n  {t(\'nav.organizacija\')}\n</h1>'),
    ).toBe('nav.organizacija');
    expect(headingKey("<p>{t('nav.danas')}</p>")).toBeNull();
    expect(headingKey('const x = 1;')).toBeNull();
    // The `[^>]*` trap: an arrow or a generic in an attribute holds a `>`.
    expect(headingKey("<h1 onClick={() => go()}>{t('nav.danas')}</h1>")).toBe('nav.danas');
    expect(headingKey("<h1 ref={useRef<HTMLHeadingElement>(null)}>{t('nav.sati')}</h1>")).toBe(
      'nav.sati',
    );
  });

  it('reads htmlFor values in source order and finds none where there are none', () => {
    expect(labelTargets('<Label htmlFor="username" /><Label htmlFor="password" />')).toEqual([
      'username',
      'password',
    ]);
    expect(labelTargets('<Label>text</Label>')).toEqual([]);
  });

  it('reads every key the member-list module declares, in both of its shapes', () => {
    // The reader story 1.5a adds, self-tested on both polarities like every
    // other detector here. It has to find THREE unions rather than the first
    // one — `messageKeyUnion` uses `exec` and would stop at the refusals — and
    // it has to find the column table's headings, which are not a return type
    // at all. A reader that found neither would make the set comparison above
    // pass against a resource file missing all eleven.
    const module = [
      "export function membersMessageKey(",
      "  failure: MembersFailure,",
      "): 'ljudi.error.refused' | 'ljudi.error.unavailable' {",
      '  return x;',
      '}',
      'export function memberLevelMessageKey(role: MemberRole): \'ljudi.admin\' | \'ljudi.member\' {',
      '  return y;',
      '}',
      'export const MEMBER_COLUMNS = [',
      "  { key: NAME_COLUMN, label: 'ljudi.name', sortValue: (m) => m.name },",
      "  { key: EMAIL_COLUMN, label: 'ljudi.email', sortValue: (m) => m.email },",
      '];',
    ].join('\n');

    expect(memberListKeys(module)).toEqual([
      'ljudi.error.refused',
      'ljudi.error.unavailable',
      'ljudi.admin',
      'ljudi.member',
      'ljudi.name',
      'ljudi.email',
    ]);
    // Both polarities: a module that declares neither shape yields nothing, and
    // a screen's own `t()` calls are NOT keys this reader may claim — those are
    // `translationKeys`' and counting them twice would hide a key that stopped
    // being declared.
    expect(memberListKeys('export function other(): string { return x; }')).toEqual([]);
    expect(memberListKeys(compliant)).toEqual([]);
  });

  it('reads the write path keys in both of its shapes, and none where there are none', () => {
    // BOTH POLARITIES, and both shapes. A reader that found only the union would
    // drop the partial-save sentence out of the rendered set, and `hr.json`
    // could then hold a message nothing renders; a reader that found nothing at
    // all would make the set comparison pass against a resource file missing
    // every one of the eleven.
    const module = [
      "export const PARTIAL_SAVE_KEY = 'ljudi.form.error.saved';",
      "export function memberWriteMessageKey(failure: F): 'a.one' | 'a.two' {",
      "  return 'a.one';",
      '}',
    ].join('\n');

    expect(memberWriteKeys(module)).toEqual(['a.one', 'a.two', 'ljudi.form.error.saved']);
    // A query key is not a message key, and the narrow constant pattern is what
    // keeps `MEMBERS_LIST_KEY` and `MEMBER_ROLE_KEY` out of the rendered set.
    expect(memberWriteKeys("export const MEMBERS_LIST_KEY = ['members'] as const;")).toEqual([]);
    expect(memberWriteKeys('const x = 1;')).toEqual([]);
  });

  it('reads the message keys off the mapping signature and none off a screen', () => {
    // The reader added when the two refusal keys left the screen. One that
    // returned nothing would drop both from the rendered set and make the
    // "every declared key is rendered" comparison quietly weaker by two.
    const signature = [
      'export function signInMessageKey(',
      '  failure: SignInFailure,',
      "): 'auth.error.credentials' | 'auth.error.unavailable' {",
      '  return failure === SIGN_IN_UNAVAILABLE',
      '}',
    ].join('\n');

    expect(messageKeyUnion(signature)).toEqual([
      'auth.error.credentials',
      'auth.error.unavailable',
    ]);
    expect(messageKeyUnion('export function other(): string { return x; }')).toEqual([]);
    expect(messageKeyUnion(compliant)).toEqual([]);
  });

  it('flattens resource keys the way i18next resolves them', () => {
    // Guards the key-set comparison: a walker that returned nothing would make
    // both directions of it pass on any file.
    expect(resourceKeys()).toContain('auth.heading');
    expect(resourceKeys()).toContain('count.days');
  });
});
