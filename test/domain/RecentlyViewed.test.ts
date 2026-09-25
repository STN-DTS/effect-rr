import { assert, describe, it } from '@effect/vitest';
import { DateTime, Schema } from 'effect';

import {
  DexNumber,
  PokemonName,
  RECENTLY_VIEWED_LIMIT,
  RecentlyViewed,
  RecentlyViewedEntry,
} from '../../server/domain/index.ts';

const entry = (name: string, at = 0) =>
  new RecentlyViewedEntry({
    name: PokemonName.make(name),
    dexNumber: DexNumber.make(1),
    viewedAt: DateTime.makeUnsafe(at),
  });
const names = (list: RecentlyViewed) => list.entries.map((e) => e.name);

describe('RecentlyViewed', () => {
  it('puts the most recent entry first', () => {
    const list = RecentlyViewed.empty.record(entry('bulbasaur')).record(entry('pikachu'));
    assert.deepStrictEqual(names(list), ['pikachu', 'bulbasaur']);
  });

  it('moves a re-viewed entry to the front without duplicating it', () => {
    const list = RecentlyViewed.empty.record(entry('bulbasaur')).record(entry('pikachu')).record(entry('bulbasaur', 5));
    assert.deepStrictEqual(names(list), ['bulbasaur', 'pikachu']);
    assert.strictEqual(DateTime.toEpochMillis(list.entries[0]!.viewedAt), 5);
  });

  it(`keeps at most ${RECENTLY_VIEWED_LIMIT} entries`, () => {
    let list = RecentlyViewed.empty;

    for (let i = 0; i < 15; i++) {
      list = list.record(entry(`p${i}`));
    }

    assert.strictEqual(list.entries.length, RECENTLY_VIEWED_LIMIT);
    assert.strictEqual(list.entries[0]!.name, 'p14');
    assert.strictEqual(list.entries.at(-1)!.name, 'p5');
  });

  it('clears', () => {
    assert.strictEqual(RecentlyViewed.empty.record(entry('pikachu')).clear().entries.length, 0);
  });

  it.prop('invariants hold for any sequence of views', [Schema.Array(PokemonName)], ([viewed]) => {
    const list = viewed.reduce((acc, name) => acc.record(entry(name)), RecentlyViewed.empty);
    const listed = names(list);
    assert.isTrue(listed.length <= RECENTLY_VIEWED_LIMIT);
    assert.strictEqual(new Set(listed).size, listed.length);

    if (viewed.length > 0) {
      assert.strictEqual(listed[0], viewed.at(-1));
    }
  });
});
