import { createRouter } from '@tanstack/react-router';

import { indexRoute } from '@/routes/index';
import { prijavaRoute } from '@/routes/prijava';
import { rootRoute } from '@/routes/__root';

const routeTree = rootRoute.addChildren([indexRoute, prijavaRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
