import { describe, it, expect } from 'vitest';
import { isRuntime, RUNTIMES } from '../src/types.js';

describe('runtime guard', () => {
  it('accepts the supported runtimes', () => {
    expect(isRuntime('python')).toBe(true);
    expect(isRuntime('node')).toBe(true);
    expect([...RUNTIMES]).toEqual(['python', 'node']);
  });

  it('rejects anything else', () => {
    for (const v of ['ruby', 'deno', '', null, undefined, 42, {}]) {
      expect(isRuntime(v)).toBe(false);
    }
  });
});
