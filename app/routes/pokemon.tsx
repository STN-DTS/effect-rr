import { Link, href, isRouteErrorResponse } from 'react-router';
import { errorPresentationOf, formatDexNumber } from '~app/features/pokemon/dto.ts';
import { loadPokemonDetail } from '~app/features/pokemon/pokemon.server.ts';
import { SearchForm } from '~app/features/pokemon/SearchForm.tsx';
import type { Route } from '~app/routes/+types/pokemon';

export function loader({ context, params }: Route.LoaderArgs) {
  return loadPokemonDetail(context, params.name);
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  return loaderData
    ? [
        { title: `${loaderData.pokemon.displayName} · Pokédex` },
        {
          name: 'description',
          content: `${loaderData.pokemon.displayName}: ${loaderData.pokemon.types.join('/')} type Pokémon.`,
        },
      ]
    : [{ title: 'Not found · Pokédex' }];
};

export default function PokemonDetail({ loaderData }: Route.ComponentProps) {
  const { pokemon } = loaderData;

  return (
    <article className="pokemon" aria-labelledby="pokemon-name">
      <header>
        <p className="dex">{formatDexNumber(pokemon.dexNumber)}</p>
        <h1 id="pokemon-name">{pokemon.displayName}</h1>
        <ul className="types" aria-label="Types">
          {pokemon.types.map((type) => (
            <li key={type} className={`type type-${type}`}>
              {type}
            </li>
          ))}
        </ul>
      </header>

      {pokemon.artworkUrl ? (
        <img
          className="artwork"
          src={pokemon.artworkUrl}
          alt={`Official artwork of ${pokemon.displayName}`}
          width={320}
          height={320}
        />
      ) : null}

      <dl className="measurements">
        <div>
          <dt>Height</dt>
          <dd>{pokemon.heightMetres.toFixed(1)} m</dd>
        </div>
        <div>
          <dt>Weight</dt>
          <dd>{pokemon.weightKilograms.toFixed(1)} kg</dd>
        </div>
      </dl>

      <table className="stats">
        <caption>Base stats</caption>
        <tbody>
          {pokemon.stats.map((stat) => (
            <tr key={stat.key}>
              <th scope="row">{stat.label}</th>
              <td>{stat.value}</td>
              <td>
                <meter min={0} max={255} value={stat.value} aria-label={`${stat.label}: ${stat.value} out of 255`} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td colSpan={2}>{pokemon.baseStatTotal}</td>
          </tr>
        </tfoot>
      </table>

      <p>
        <Link to={href('/')}>← Back to search</Link>
      </p>
    </article>
  );
}

export function ErrorBoundary({ error, params }: Route.ErrorBoundaryProps) {
  if (!isRouteErrorResponse(error)) {
    throw error; // defects bubble to the root boundary (500)
  }

  const { title, message } = errorPresentationOf(error);

  return (
    <section className="error" aria-labelledby="error-title">
      <h1 id="error-title">{title}</h1>
      <p data-status={error.status}>{message}</p>
      <SearchForm search={{ value: params.name ?? '', error: null }} />
    </section>
  );
}
