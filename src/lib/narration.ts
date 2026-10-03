/**
 * Narration helpers shared by the client and the optional serverless rephrasing function.
 * Offline, templated narration is the default; an LLM may only rephrase a template, never add
 * facts, so any number in its output must already be in the template.
 */

export const NARRATION_MODEL = 'claude-opus-5-5';
/** USD per million tokens for NARRATION_MODEL (Anthropic list price). */
export const PRICE_PER_MTOK = { input: 4, output: 20 } as const;

export function costUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
}

const numbers = (t: string) => (t.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** True when every number in the rephrased text appears in the source text. */
export function keepsFacts(source: string, rephrased: string): boolean {
  const allowed = new Set(numbers(source));
  return numbers(rephrased).every((n) => allowed.has(n));
}

/** House style: British English, no em or en dashes used as punctuation. */
export function houseStyle(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

export const NARRATION_SYSTEM = [
  'You rephrase one line of narration for a live presentation of a power grid digital twin to senior executives.',
  'Rules: keep every fact and number exactly as given and add no new facts, figures, names or claims.',
  'Write in British English, plain and calm, at most two short sentences, suitable for speaking aloud.',
  'Do not use em dashes or en dashes. Do not mention live data or real-time control. Reply with the line only.',
].join(' ');
