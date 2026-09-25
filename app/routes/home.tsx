import { Form, Link, href, useNavigation } from 'react-router';

import { formatDexNumber } from '~/features/pokemon/dto.ts';
import { homeAction, loadHome } from '~/features/pokemon/pokemon.server.ts';
import { SearchForm } from '~/features/pokemon/SearchForm.tsx';

import type { Route } from './+types/home';

export function loader({ context, url }: Route.LoaderArgs) {
  return loadHome(context, url.searchParams.get('name'));
}

export async function action({ context, request }: Route.ActionArgs) {
  return homeAction(context, await request.formData());
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: loaderData?.search.error ? 'Invalid search · Pokédex' : 'Pokédex' },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { recentlyViewed, search } = loaderData;
  const navigation = useNavigation();
  const clearing = navigation.state !== 'idle' && navigation.formMethod === 'POST';

  return (
    <>
      <h1>Find a Pokémon</h1>
      <SearchForm search={search} />

      <section aria-labelledby="recent-title" className="recent">
        <h2 id="recent-title">Recently viewed</h2>
        {recentlyViewed.length === 0 ? (
          <p className="muted">Nothing yet — search for a Pokémon to get started.</p>
        ) : (
          <>
            <ol className="recent-list" aria-label="Recently viewed Pokémon">
              {recentlyViewed.map((entry) => (
                <li key={entry.name}>
                  <Link to={href('/pokemon/:name', { name: entry.name })}>{entry.displayName}</Link>{' '}
                  <span className="muted">{formatDexNumber(entry.dexNumber)}</span>
                </li>
              ))}
            </ol>
            <Form method="post">
              <input type="hidden" name="intent" value="clear" />
              <button type="submit" className="secondary" disabled={clearing}>
                {clearing ? 'Clearing…' : 'Clear list'}
              </button>
            </Form>
          </>
        )}
      </section>
    </>
  );
}
