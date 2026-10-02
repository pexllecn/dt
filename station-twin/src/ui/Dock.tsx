/** Scenario library, grouped as in the prototype, with line icons and severity markers. */
import { SCENARIOS, type ScenarioId } from '../sim/scenarios.ts';
import type { SimClient } from '../app/client.ts';
import { confirmReq, dockOpen, toast } from '../app/store.ts';
import { Icon } from './icons.tsx';

export function Dock({ client }: { client: SimClient }) {
  const groups = [...new Set(SCENARIOS.map((s) => s.group))];
  const run = async (id: ScenarioId) => {
    const r = await client.command({ type: 'scenario', id });
    toast.value = { result: r, key: Date.now() };
  };
  const ask = (id: ScenarioId, title: string) => {
    if (id === 'reset') confirmReq.value = { title: 'Reset to baseline?', body: 'The station returns to 12:00 on a normal day. Built plant and scenario changes are cleared.', action: 'Reset', run: () => void run(id) };
    else void run(id);
    void title;
  };
  return (
    <aside class={`dock panel ${dockOpen.value ? '' : 'closed'}`} aria-label="Scenario library">
      <header>
        <h2>Scenarios</h2>
        <button class="iconbtn" aria-label="Hide scenarios" title="Hide (S)" onClick={() => (dockOpen.value = false)}><Icon name="panel" size={14} /></button>
      </header>
      <div class="scroll">
        {groups.map((g) => (
          <div key={g}>
            <div class="group">{g}</div>
            {SCENARIOS.filter((s) => s.group === g).map((s) => (
              <button class="scn" key={s.id} onClick={() => ask(s.id, s.title)} title={s.description}>
                <Icon name={s.icon} size={17} />
                <span><b>{s.title}</b><span>{s.description}</span></span>
                <i class="sev" data-s={s.severity} aria-label={`Severity: ${s.severity}`} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
