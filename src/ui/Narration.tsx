import { useEffect, useRef, useState } from 'react';
import { beatText, scripts } from '@/director/scripts';
import { useDirector } from '@/director/store';
import { NARRATION_MODEL } from '@/lib/narration';
import { useUi } from './uiStore';

interface Spend {
  calls: number;
  input: number;
  output: number;
  usd: number;
}

const cache = new Map<string, { text: string; source: 'llm' | 'template' }>();

/**
 * Narration for the current Director beat. Offline templates by default. "Rephrase" sends the
 * template to the optional serverless function (off unless deployed with a key); the reply may
 * not add facts, and every call's tokens and cost are counted on screen.
 */
export function Narration() {
  const on = useUi((s) => s.narrationOn);
  const set = useUi((s) => s.set);
  const mode = useDirector((s) => s.mode);
  const script = useDirector((s) => s.script);
  const beat = useDirector((s) => s.beat);
  const [llm, setLlm] = useState(() => new URLSearchParams(location.search).get('narration') === 'llm');
  const [speak, setSpeak] = useState(false);
  const [shown, setShown] = useState<{ text: string; source: 'template' | 'llm' | 'pending' }>({ text: '', source: 'template' });
  const [spend, setSpend] = useState<Spend>({ calls: 0, input: 0, output: 0, usd: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const seq = useRef(0);

  const b = scripts[script].beats[beat];
  const template = b ? beatText(b.narration) : '';

  useEffect(() => {
    if (!on || mode !== 'director' || !template) return;
    const my = ++seq.current;
    setShown({ text: template, source: 'template' });
    if (!llm) return;
    const hit = cache.get(template);
    if (hit) {
      setShown(hit);
      return;
    }
    setShown({ text: template, source: 'pending' });
    fetch(`${import.meta.env.BASE_URL}api/narrate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: template }) })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 501 ? 'not enabled on this deployment' : `HTTP ${r.status}`);
        return (await r.json()) as { text: string; source: 'llm' | 'template'; usage: { input: number; output: number }; costUsd: number };
      })
      .then((res) => {
        setSpend((s) => ({ calls: s.calls + 1, input: s.input + res.usage.input, output: s.output + res.usage.output, usd: s.usd + res.costUsd }));
        cache.set(template, { text: res.text, source: res.source });
        if (my === seq.current) setShown({ text: res.text, source: res.source });
        setStatus(null);
      })
      .catch((e: unknown) => {
        if (my === seq.current) setShown({ text: template, source: 'template' });
        setStatus(`Rephrasing unavailable (${e instanceof Error ? e.message : 'error'}); using the template.`);
      });
  }, [on, mode, template, llm]);

  useEffect(() => {
    if (!speak || !on || shown.source === 'pending' || !shown.text || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(shown.text);
    u.lang = 'en-GB';
    const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-GB');
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return () => speechSynthesis.cancel();
  }, [speak, on, shown]);

  if (!on || mode !== 'director') return null;
  return (
    <section
      className="absolute bottom-[150px] right-8 z-20 w-[340px] border hairline px-4 pb-3 pt-3 backdrop-blur-md"
      style={{ background: 'var(--panel)' }}
      aria-label="Narration"
    >
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.16em] text-ink-soft">
        <span>Narration</span>
        <button className="normal-case tracking-normal text-ink-soft underline underline-offset-4" onClick={() => set({ narrationOn: false })}>
          close
        </button>
      </div>
      <p className={`mt-1.5 text-[13px] leading-relaxed text-ink ${shown.source === 'pending' ? 'opacity-50' : ''}`}>{shown.text}</p>
      <p className="mt-1.5 text-[10px] text-ink-faint">
        {shown.source === 'llm' ? `Rephrased by ${NARRATION_MODEL}; facts checked against the template.` : 'Offline template.'}
      </p>
      {status && <p className="mt-1 text-[10px] text-amber">{status}</p>}
      <div className="mt-2 flex items-center gap-4 border-t hairline pt-2 text-[11px]">
        <label className="flex items-center gap-1.5 text-ink">
          <input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} /> Rephrase with LLM
        </label>
        <label className="flex items-center gap-1.5 text-ink">
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Speak
        </label>
      </div>
      <p className="figure mt-1.5 text-[10px] text-ink-faint">
        {spend.calls} calls · {spend.input + spend.output} tokens · ${spend.usd.toFixed(4)}
      </p>
    </section>
  );
}
