const PENDING_ROWS = [0, 1, 2];

/**
 * What a route renders while its `beforeLoad` is still deciding (A224) — the
 * router's `defaultPendingComponent`, so every route shares one.
 *
 * The guards await the session (`_app.tsx`, `index.tsx`) and the permission
 * level (the admin guards), and supabase-js may satisfy the session read with a
 * token refresh over the network. With no pending component, a slow connection
 * held the previous frame — or a blank one on the first load — for the whole
 * read. The router shows this only once a resolution has taken longer than
 * `defaultPendingMs` (`router.ts`), so a fast guard paints nothing extra.
 *
 * THE PAGE SKELETON'S SHAPE (DESIGN.md): a title bar, then a block per row, in
 * the muted pulse every skeleton here uses. No spinner and NO TEXT: it renders
 * inside the chrome when a destination's own guard is pending, and in its place
 * when the layout's is, so it names nothing that could be wrong in either.
 */
export function RoutePending() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy>
      <div className="h-8 w-56 max-w-full animate-pulse rounded-sm bg-muted" />
      <div className="flex flex-col gap-2">
        {PENDING_ROWS.map((row) => (
          <div key={row} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </main>
  );
}
