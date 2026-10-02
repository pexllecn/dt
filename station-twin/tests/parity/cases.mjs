// Parity cases: each is a sequence of prototype actions applied from the prototype's own reset.
// Shared by the fixture generator (which runs the prototype) and the parity test (which runs the port).
export const SCENARIO_IDS = [
  'ie_estate', 'ni_estate', 'ind_exp',
  'add_solar', 'add_bess', 'add_gas', 'wind_up', 'wind_dn', 'sun_set',
  'imp_n', 'exp_s', 'nbr_off',
  'peak', 'split', 'n1', 'busfault', 'cool_fail', 'storm',
  'reset',
];

/** Frame step used when evolving time after an action (prototype dt is wall seconds). */
export const FRAME_DT = 0.05;
/** Checkpoints (in prototype seconds after the actions) at which state is recorded. */
export const CHECKPOINTS = [0, 1, 3, 6, 10, 20];

export const CASES = [
  ...SCENARIO_IDS.map((id) => ({ name: `scenario:${id}`, actions: [{ scenario: id }] })),
  { name: 'chain:growth', actions: [{ scenario: 'ie_estate' }, { scenario: 'ni_estate' }, { scenario: 'ind_exp' }] },
  { name: 'chain:solar-battery-sunset', actions: [{ scenario: 'add_solar' }, { scenario: 'add_bess' }, { set: ['BESS', 'set', 80] }, { scenario: 'sun_set' }] },
  { name: 'chain:surge-export', actions: [{ scenario: 'add_solar' }, { scenario: 'wind_up' }, { scenario: 'add_gas' }, { set: ['GAS', 'out', 180] }] },
  { name: 'chain:peak-n1', actions: [{ scenario: 'peak' }, { scenario: 'n1' }] },
  { name: 'chain:peak-n1-relief', actions: [{ scenario: 'peak' }, { scenario: 'n1' }, { scenario: 'imp_n' }, { scenario: 'add_bess' }, { set: ['BESS', 'set', 80] }] },
  { name: 'chain:battery-charge', actions: [{ scenario: 'add_bess' }, { set: ['BESS', 'set', -100] }] },
  { name: 'chain:autobalance', actions: [{ scenario: 'add_solar' }, { scenario: 'add_bess' }, { scenario: 'add_gas' }, { scenario: 'peak' }, { autoBalance: true }] },
  { name: 'chain:forced-cooling', actions: [{ scenario: 'peak' }, { set: ['T1', 'cool', true] }, { set: ['T2', 'cool', true] }] },
  { name: 'chain:open-t3', actions: [{ toggle: 'T3' }] },
  { name: 'chain:open-wind', actions: [{ toggle: 'WIND' }] },
  { name: 'chain:busfault-clear', actions: [{ scenario: 'busfault' }, { clearFault: true }] },
  { name: 'chain:split-recouple', actions: [{ scenario: 'split' }, { recouple: true }] },
  { name: 'chain:shed', actions: [{ scenario: 'peak' }, { setSys: ['shedMW', 120] }] },
];
