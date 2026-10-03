import Anthropic from '@anthropic-ai/sdk';
import { NARRATION_MODEL, NARRATION_SYSTEM, costUsd, houseStyle, keepsFacts } from '../src/lib/narration';

/**
 * Optional narration rephrasing (Vercel function). Off unless NARRATION_LLM=on and an Anthropic
 * credential is configured; the client falls back to the offline template on any non-200.
 * POST { text: string } -> { text, model, usage: { input, output }, costUsd, source }
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.NARRATION_LLM !== 'on' || !process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'LLM narration is not enabled on this deployment.' }, { status: 501 });
  }
  let text = '';
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return Response.json({ error: 'Expected JSON { text }.' }, { status: 400 });
  }
  if (!text || text.length > 800) return Response.json({ error: 'text must be 1 to 800 characters.' }, { status: 400 });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: NARRATION_MODEL,
      max_tokens: 2000,
      // Short rephrasing: low effort is enough. A safety decline is retried on a fallback model.
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: NARRATION_SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
    const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens };
    const cost = costUsd(usage.input, usage.output);
    const out = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
    // Refused, empty, or a changed number: keep the template (credibility over fluency).
    if (response.stop_reason === 'refusal' || !out.trim() || !keepsFacts(text, out)) {
      return Response.json({ text, model: response.model, usage, costUsd: cost, source: 'template' });
    }
    return Response.json({ text: houseStyle(out), model: response.model, usage, costUsd: cost, source: 'llm' });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: 'Rate limited.' }, { status: 429 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: `Upstream error ${error.status}.` }, { status: 502 });
    return Response.json({ error: 'Narration unavailable.' }, { status: 502 });
  }
}
