Recorded from `https://pokeapi.co/api/v2/pokemon/<name>` on 2026-09-25.

To keep the repository small, the large arrays the app never reads (`moves`,
`game_indices`, `held_items`, `past_*`) and all sprite variants except
`front_default` and `other.official-artwork` were stripped. Everything else is
verbatim, so the decoder is still exercised against unknown extra fields.

`malformed.json` is hand-written: a payload whose `stats` entries are missing `base_stat`.

These fixtures are shared by the infrastructure unit tests (fake HttpClient)
and the Playwright stub server (`e2e/stub-pokeapi.ts`).
