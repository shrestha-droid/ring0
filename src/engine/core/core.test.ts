import { expect, it } from 'vitest';
import { mulberry32 } from './rng';
import { decodeScenario, encodeScenario } from './share';

it('rng is seeded and reproducible', () => {
  const a = mulberry32(42), b = mulberry32(42);
  const xs = Array.from({ length: 5 }, a);
  expect(Array.from({ length: 5 }, b)).toEqual(xs);
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
});

it('share links round-trip and reject garbage', () => {
  const env = { v: 1 as const, module: 'memory' as const, params: { refs: [1, 2, 3], frames: 3, algo: 'lru' } };
  expect(decodeScenario(encodeScenario(env))).toEqual(env);
  expect(decodeScenario('not-a-scenario')).toBeNull();
  expect(decodeScenario(encodeScenario({ ...env, v: 2 } as never))).toBeNull();
  expect(decodeScenario(encodeScenario({ ...env, module: 'kernel' } as never))).toBeNull();
});
