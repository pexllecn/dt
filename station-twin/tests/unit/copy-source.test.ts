/**
 * Copy lint: British English, no em dashes, no emojis, the exact badge, and no third-party
 * branding, across every source file the interface is built from.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRANDING } from '../../src/config/branding.ts';

const ROOT = join(import.meta.dirname, '../..');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|html|md)$/.test(f)) out.push(p);
  }
  return out;
}
const files = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html'), ...walk(join(ROOT, 'docs'))];

/** Human-readable strings: quoted literals and JSX text that contain at least one space. */
function strings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of src.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)) out.push(m[1]!);
  return out.filter((s) => /[A-Za-z]{2,}\s+[A-Za-z]/.test(s));
}

const AMERICAN = /\b(colou?r(?<!colour)s?|center(ed|s)?|behaviors?|analyz(e|ed|es|ing)|optimiz(e|ed|es|ing|ation)|organizations?|gray|favorites?|labeled|canceled|modeling|traveled|catalog|defense|programs?|meters?|liters?|fiber)\b/i;

describe('copy in source files', () => {
  it('has no em dashes anywhere', () => {
    for (const f of files) expect(readFileSync(f, 'utf8').includes('—'), f).toBe(false);
  });
  it('has no emojis anywhere', () => {
    for (const f of files) expect(/\p{Emoji_Presentation}|\uFE0F/u.test(readFileSync(f, 'utf8')), f).toBe(false);
  });
  it('uses British spellings in every interface string', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => /\.(ts|tsx|html)$/.test(x))) {
      for (const s of strings(readFileSync(f, 'utf8'))) {
        const m = s.match(AMERICAN);
        if (m && !/^[a-z]+[A-Z]/.test(m[0]) && !/currentColor|colorNode|color:|\.color|setColor|instanceColor|text-align|align-items/.test(s)) bad.push(`${f.replace(ROOT, '')}: "${m[0]}" in "${s.slice(0, 80)}"`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('shows the badge exactly, and no utility branding', () => {
    expect(BRANDING.badge).toBe('Demonstration environment. Fictional station. Values simulated with documented assumptions.');
    for (const f of files.filter((x) => /src|index\.html/.test(x))) expect(/eirgrid/i.test(readFileSync(f, 'utf8')), f).toBe(false);
  });
});
