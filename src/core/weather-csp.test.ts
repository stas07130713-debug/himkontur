import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('weather network policy', () => {
  it('allows every forecast provider used by the application', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(html).toContain('https://api.open-meteo.com');
    expect(html).toContain('https://archive-api.open-meteo.com');
    expect(html).toContain('https://api.met.no');
    expect(html).toContain('https://wttr.in');
  });
});
