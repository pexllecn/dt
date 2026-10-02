import { useUi } from './uiStore';

/** Quiet text links under the masthead: method notes, governance and the audit trail. */
export function Toolbar() {
  const ui = useUi();
  const link = (on: boolean) => `underline-offset-4 ${on ? 'text-ink underline' : 'text-ink-soft hover:text-ink hover:underline'}`;
  return (
    <nav className="halo absolute left-8 top-[92px] z-20 flex gap-5 text-[11.5px]" aria-label="Panels">
      <button className={link(ui.notesOpen)} onClick={() => ui.set({ notesOpen: !ui.notesOpen })}>
        Method
      </button>
      <button className={link(ui.governanceOpen)} onClick={() => ui.set({ governanceOpen: !ui.governanceOpen })}>
        Governance
      </button>
      <button className={link(ui.auditOpen)} onClick={() => ui.set({ auditOpen: !ui.auditOpen })}>
        Audit trail <span className="figure">{ui.audit.length}</span>
      </button>
    </nav>
  );
}
