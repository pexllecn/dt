// Runs the original prototype's script, unchanged, inside a Node VM with inert DOM stubs.
// The harness exposes the prototype's own globals (C, SYS, R, solve, SCEN, UI, autoBalance, quick)
// so fixtures are produced by the original code, not by a reading of it.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '../../reference/clonmore-prototype.html'), 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

/** A callable, chainable stub that absorbs any DOM or canvas usage and coerces to "" / 0. */
function inert() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => '';
      if (key === Symbol.iterator) return function* () {};
      if (key === 'forEach') return () => undefined;
      if (key === 'length') return 0;
      if (key === 'firstChild' || key === 'lastChild') return null;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

export function createPrototype() {
  const timers = [];
  let now = 0;
  const ctx = {
    console,
    Math, JSON, Object, Array, Number, String, Boolean, Symbol, Proxy, Error,
    document: inert(),
    window: inert(),
    devicePixelRatio: 1,
    requestAnimationFrame: () => 0,
    setTimeout: (fn, ms) => { timers.push({ at: now + ms / 1000, fn }); return timers.length; },
    clearTimeout: () => undefined,
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { filename: 'clonmore-prototype.html' });
  const get = (expr) => vm.runInContext(expr, ctx);

  return {
    get,
    /** Advance prototype wall time by dt seconds, mirroring frame(): timers, storm countdown, solve. */
    frame(dt) {
      now += dt;
      for (let i = 0; i < timers.length; i++) {
        const t = timers[i];
        if (t && t.at <= now + 1e-9) { timers[i] = null; t.fn(); }
      }
      get(`if (SYS.storm > 0) SYS.storm -= ${dt}; solve(${dt});`);
    },
    /** Apply a scenario exactly as the scenario button handler does. */
    runScenario(id) {
      get(`(function(){ const s = SCEN.find(x => x.id === ${JSON.stringify(id)}); s.run(); solve(0.4); })()`);
    },
    snapshot() {
      return JSON.parse(get(`JSON.stringify({ C, SYS, R })`));
    },
  };
}
