import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// The engine must stay pure and deterministic: no UI, no clock, no unseeded randomness.
it('engine source has no impure dependencies', () => {
  const dir = join(__dirname);
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  expect(files).toContain('scheduler/run.ts');
  const bad = files.flatMap((f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    return [/from ['"]react/, /from ['"]zustand/, /\bdocument\./, /\bwindow\./, /Math\.random/, /\bDate\b/, /performance\.now/]
      .filter((re) => re.test(src))
      .map((re) => `${f}: ${re}`);
  });
  expect(bad).toEqual([]);
});
