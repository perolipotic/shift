/**
 * Install from *Više* (story 8.4): what the *Instaliraj* row can do on this
 * device, decided from injected sources so the node suite executes it
 * (AD-15). The page's instance, over `window`, is `./page-install`.
 *
 * FOUR KINDS, IN THIS ORDER:
 * - `installed`: the app runs as an installed app (`display-mode`
 *   `standalone`, `fullscreen`, `minimal-ui` or `window-controls-overlay`, or
 *   iOS's `navigator.standalone`), or `appinstalled` fired. The row is gone.
 *   On iOS an app added to the Home Screen but opened in a browser tab
 *   reports nothing, so the row still shows there (human decision 2026-10-23,
 *   1a).
 * - `prompt`: the browser offered an install prompt (`beforeinstallprompt`),
 *   held here. A press opens it; nothing opens it without one.
 * - `ios`: a browser on iOS or iPadOS, which offers no prompt. A press
 *   reveals the Share → Add to Home Screen steps inline. An app's own
 *   in-app browser is not one: it has no Add to Home Screen.
 * - `none`: nothing the row could do (Firefox desktop, Chrome before the
 *   event). The row is not drawn.
 */

export type InstallKind = 'prompt' | 'ios' | 'installed' | 'none';

/** The kinds a screen branches on, as constants: a screen holds no literals. */
export const INSTALL_PROMPT = 'prompt' satisfies InstallKind;
export const INSTALL_IOS = 'ios' satisfies InstallKind;

/** What the platform says about itself, as `navigator` carries it. */
export interface DeviceTraits {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
}

/** As much of the `beforeinstallprompt` event as the store uses. */
export interface InstallPromptEvent {
  preventDefault(): void;
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<unknown>;
}

/**
 * Safari (`Version/… Safari/`), and Chrome, Firefox and Edge for iOS by
 * their own markers. An in-app browser (Instagram, Facebook, Messenger, the
 * Google app) carries none of them.
 */
const IOS_BROWSER = /\b(?:CriOS|FxiOS|EdgiOS)\/|\bVersion\/[\d.]+.*\bSafari\//;

/**
 * iOS and iPadOS, in a browser (human decision 2026-10-22, 3a): every iOS
 * browser is WebKit and, since iOS 16.4, adds to the Home Screen. An app's
 * in-app browser cannot, so it gets no steps (code review 2026-10-26). An
 * iPad asks for the desktop site and reports `MacIntel`; its touch points
 * tell it from a Mac.
 */
export function isIos(traits: DeviceTraits): boolean {
  const device = /iPad|iPhone|iPod/.test(traits.userAgent) || (traits.platform === 'MacIntel' && traits.maxTouchPoints > 1);
  return device && IOS_BROWSER.test(traits.userAgent);
}

/** The row's kind. Installed wins over everything; a held prompt over iOS. */
export function installKindOf(state: { installed: boolean; held: boolean; ios: boolean }): InstallKind {
  if (state.installed) return 'installed';
  if (state.held) return 'prompt';
  if (state.ios) return 'ios';
  return 'none';
}

/** Where the store reads the device from. Every read is a function, so nothing touches the page before `start`. */
export interface InstallSources {
  /** Whether the app runs as an installed app now. */
  standalone(): boolean;
  traits(): DeviceTraits;
  onBeforeInstallPrompt(listener: (event: InstallPromptEvent) => void): () => void;
  onAppInstalled(listener: () => void): () => void;
  /** Called when the display mode may have changed. Optional. */
  onDisplayModeChange?(listener: () => void): () => void;
  /**
   * Resolves after `ms`: the bound on a member's choice that never settles.
   * An abort of `signal` cancels it once the choice settles first. Defaults
   * to `setTimeout`.
   */
  wait?(ms: number, signal: AbortSignal): Promise<void>;
}

/**
 * How long a shown prompt may go unanswered before its event counts as spent:
 * a `userChoice` that never settles must not leave the row visible but dead.
 */
export const PROMPT_CHOICE_TIMEOUT_MS = 120_000;

/** What the row draws: its kind, and whether a prompt it opened is showing. */
export interface InstallSnapshot {
  readonly kind: InstallKind;
  /** A prompt this row opened is showing; a press does nothing until it settles. */
  readonly prompting: boolean;
}

/** Nothing known: before `start`, after a failed `start`, and on a server render. */
export const INSTALL_NOTHING: InstallSnapshot = { kind: 'none', prompting: false };

/** The install store: the snapshot, its listeners and the one press. */
export interface InstallStore {
  /** The current snapshot; the same object until it changes. */
  snapshot(): InstallSnapshot;
  /** Called after every change of the snapshot. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Opens the held prompt. Only a press calls this. After the member's
   * choice, accepted or dismissed, or once the choice has gone unanswered for
   * {@link PROMPT_CHOICE_TIMEOUT_MS}, the event is dropped and the row hides
   * until a new one. With no event held, or one already showing, it does
   * nothing.
   */
  prompt(): Promise<void>;
  /**
   * Listens from now on. Idempotent: a second call while listening returns
   * the same stop. NEVER THROWS: a source that fails leaves the row
   * undrawn, never the app unbooted. The stop drops the held event.
   */
  start(): () => void;
}

/** An event the store can use: a `prompt` to call and a `userChoice` to await. */
function promptable(event: unknown): event is InstallPromptEvent {
  if (typeof event !== 'object' || event === null) return false;

  const candidate = event as Partial<Record<'prompt' | 'userChoice', unknown>>;
  const choice = candidate.userChoice as { then?: unknown } | null | undefined;

  return typeof candidate.prompt === 'function' && typeof choice?.then === 'function';
}

function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  });
}

export function installStore(sources: InstallSources): InstallStore {
  const wait = sources.wait ?? defaultWait;
  let held: InstallPromptEvent | null = null;
  // The event whose prompt is showing, so a settling prompt never clears a
  // newer one's state.
  let showing: InstallPromptEvent | null = null;
  // `appinstalled` is sticky across a stop and a start (a hot reload): once
  // installed, always. The display mode is read fresh on every change: a
  // browser tab in fullscreen (F11, a video) matches `fullscreen` too, and
  // must get its row back when it leaves.
  let appInstalled = false;
  let displayInstalled = false;
  let ios = false;
  let current: InstallSnapshot = INSTALL_NOTHING;
  let stop: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function update(): void {
    const kind = installKindOf({ installed: appInstalled || displayInstalled, held: held !== null, ios });
    const prompting = kind === 'prompt' && showing !== null && showing === held;
    if (kind === current.kind && prompting === current.prompting) return;
    current = { kind, prompting };
    for (const listener of [...listeners]) listener();
  }

  function settle(event: InstallPromptEvent): void {
    // A newer event may have arrived meanwhile; only the one shown is dropped.
    if (showing === event) showing = null;
    if (held === event) held = null;
    update();
  }

  return {
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prompt: async () => {
      const event = held;
      if (event === null || showing === event) return;
      showing = event;
      update();
      // The bound covers the prompt opening as well as the choice, and is
      // cancelled once either settles first.
      const bound = new AbortController();
      try {
        await Promise.race([
          event.prompt().then(() => event.userChoice),
          wait(PROMPT_CHOICE_TIMEOUT_MS, bound.signal),
        ]);
      } catch {
        // A prompt that cannot open (shown already, or refused by the
        // browser) is as spent as one answered.
      } finally {
        bound.abort();
        settle(event);
      }
    },
    start: () => {
      if (stop !== null) return stop;

      const stops: (() => void)[] = [];
      const stopAll = () => {
        for (const unsubscribe of stops.splice(0)) unsubscribe();
      };

      try {
        ios = isIos(sources.traits());
        displayInstalled = sources.standalone();

        // One push per source: a later source that throws must not lose an
        // earlier one's unsubscribe.
        stops.push(
          sources.onBeforeInstallPrompt((event) => {
            if (!promptable(event)) return;
            // Kept, never shown, on every page, sign-in included (human
            // decision 2026-10-23, 2a): the browser's own mini-infobar stays
            // away, and only a press on *Instaliraj* opens the prompt. A new
            // event replaces the held one, and a prompt still showing for the
            // old one no longer holds the row.
            event.preventDefault();
            held = event;
            showing = null;
            update();
          }),
        );
        stops.push(
          sources.onAppInstalled(() => {
            appInstalled = true;
            held = null;
            showing = null;
            update();
          }),
        );
        if (sources.onDisplayModeChange !== undefined) {
          stops.push(
            sources.onDisplayModeChange(() => {
              displayInstalled = sources.standalone();
              update();
            }),
          );
        }
      } catch {
        // A failure only disables the row.
        stopAll();
        ios = false;
        displayInstalled = false;
        held = null;
        showing = null;
        current = INSTALL_NOTHING;
        for (const listener of [...listeners]) listener();
        return () => {};
      }

      update();

      stop = () => {
        stopAll();
        held = null;
        showing = null;
        stop = null;
        update();
      };
      return stop;
    },
  };
}
