import { describe, it, expect } from 'vitest';
import {
  buildSkillArtifact,
  parseSkillFrontmatter,
  splitCommand,
  runCommand,
  defaultEntry,
  defaultSelftest,
} from '../../src/foundry/skill.js';
import { synthesizeSpecSchema } from '../../src/foundry/spec.js';

function spec(overrides: Record<string, unknown> = {}) {
  return synthesizeSpecSchema.parse({
    name: 'adder',
    description: 'adds two ints',
    runtime: 'python',
    script: 'print(1)',
    ...overrides,
  });
}

describe('buildSkillArtifact', () => {
  it('assembles a provisional python skill with defaults', () => {
    const art = buildSkillArtifact(spec());
    expect(art.name).toBe('adder');
    expect(art.frontmatter.type).toBe('tool');
    expect(art.frontmatter.status).toBe('provisional');
    expect(art.frontmatter.runtime).toBe('python');
    expect(art.frontmatter.entry).toBe('tool.py');
    expect(art.frontmatter.selftest).toBe('python /tool/tool.py --selftest');
    expect(art.script.filename).toBe('tool.py');
    expect(art.script.contents.endsWith('\n')).toBe(true);
    // The SKILL.md round-trips through the frontmatter parser.
    const fm = parseSkillFrontmatter(art.skillMarkdown);
    expect(fm.name).toBe('adder');
    expect(fm.entry).toBe('tool.py');
  });

  it('honors explicit entry/selftest/network and node runtime', () => {
    const art = buildSkillArtifact(
      spec({ runtime: 'node', entry: 'main.js', selftest: 'node /tool/main.js --check', network: ['api.example.com'] }),
    );
    expect(art.frontmatter.runtime).toBe('node');
    expect(art.frontmatter.entry).toBe('main.js');
    expect(art.frontmatter.selftest).toBe('node /tool/main.js --check');
    expect(art.frontmatter.network).toEqual(['api.example.com']);
    expect(art.script.filename).toBe('main.js');
  });
});

describe('runtime defaults', () => {
  it('picks the right entry + selftest per runtime', () => {
    expect(defaultEntry('python')).toBe('tool.py');
    expect(defaultEntry('node')).toBe('tool.js');
    expect(defaultSelftest('python', 'tool.py')).toBe('python /tool/tool.py --selftest');
    expect(defaultSelftest('node', 'tool.js')).toBe('node /tool/tool.js --selftest');
  });
});

describe('parseSkillFrontmatter', () => {
  it('rejects a SKILL.md missing required fields', () => {
    const bad = ['---', 'name: x', 'type: tool', '---', 'body'].join('\n');
    expect(() => parseSkillFrontmatter(bad)).toThrow(/invalid SKILL.md frontmatter/);
  });
});

describe('splitCommand', () => {
  it('splits plain and quoted argv', () => {
    expect(splitCommand('python /tool/tool.py --selftest')).toEqual([
      'python',
      '/tool/tool.py',
      '--selftest',
    ]);
    expect(splitCommand('node /tool/m.js "a b" c')).toEqual(['node', '/tool/m.js', 'a b', 'c']);
  });
});

describe('runCommand', () => {
  it('builds the in-container entry command with args', () => {
    const fm = buildSkillArtifact(spec({ runtime: 'node', entry: 'm.js' })).frontmatter;
    expect(runCommand(fm, ['x', 'y'])).toEqual(['node', '/tool/m.js', 'x', 'y']);
  });
});
