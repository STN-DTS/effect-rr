import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../fixtures/pokeapi/', import.meta.url));

/** Raw recorded PokeAPI body for `name`, as a string. */
export const fixture = (name: string): string => readFileSync(`${dir}${name}.json`, 'utf8');
