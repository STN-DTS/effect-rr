import type { ReactNode } from 'react';
import { href, isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigation } from 'react-router';

import type { Route } from './+types/root';
import { requestMiddleware } from './lib/request.server.ts';

import './app.css';

export const middleware: Route.MiddlewareFunction[] = [requestMiddleware];

export const meta: Route.MetaFunction = () => [
  { title: 'Pokédex' },
  { name: 'description', content: 'Look up any Pokémon by name.' },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  return (
    <>
      <header className="site-header">
        <Link to={href('/')} className="brand">
          Pokédex
        </Link>
        <output className="global-pending" aria-live="polite">
          {busy ? 'Loading…' : ''}
        </output>
      </header>
      <main aria-busy={busy}>{children}</main>
    </>
  );
}

export default function App() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = 'Something went wrong';
  let details = 'An unexpected error occurred. Please try again.';

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Page not found' : `Error ${error.status}`;
    details = error.status === 404 ? "We couldn't find that page." : error.statusText || details;
  }

  return (
    <Shell>
      <section className="error" aria-labelledby="error-title">
        <h1 id="error-title">{title}</h1>
        <p>{details}</p>
        <p>
          <Link to={href('/')}>Back to search</Link>
        </p>
      </section>
    </Shell>
  );
}
