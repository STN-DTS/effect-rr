import { Form, href, useNavigation } from 'react-router';

import type { SearchState } from './dto.ts';

export function SearchForm({ search }: { search: SearchState }) {
  const navigation = useNavigation();

  const errorId = 'name-error';
  const searching =
    navigation.state !== 'idle' && navigation.formMethod === 'GET' && navigation.location.pathname === href('/');

  return (
    <search>
      <Form method="get" action={href('/')} className="search" noValidate>
        <label htmlFor="name">Pokémon name or number</label>
        <div className="search-row">
          <input
            id="name"
            name="name"
            type="search"
            defaultValue={search.value}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. pikachu"
            aria-invalid={search.error ? true : undefined}
            aria-describedby={search.error ? errorId : undefined}
          />
          <button type="submit" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {search.error ? (
          <p id={errorId} className="field-error" role="alert">
            {search.error}
          </p>
        ) : null}
      </Form>
    </search>
  );
}
