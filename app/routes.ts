import { index, route } from '@react-router/dev/routes';
import type { RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('pokemon/:name', 'routes/pokemon.tsx'),
  route('healthz', 'routes/healthz.ts'),
] satisfies RouteConfig;
