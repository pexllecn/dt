import { LU } from './linalg';

/**
 * Linearised (DC) power flow: lossless, flat voltage, small angles, reactance only.
 *   B theta = P,   flow_l = (theta_from - theta_to) / x_l
 * Sensitivities: PTDF and LODF from the inverse of the reduced susceptance matrix.
 */
export interface FlowBranch {
  from: number;
  to: number;
  x: number;
}

export interface DCSolver {
  /** Buses energised in the main island (others are de-energised by outages). */
  energised: Uint8Array;
  /** Per-branch flag: 1 if in service and both ends energised. */
  active: Uint8Array;
  /** Branch flows in MW for bus injections in MW (generation minus load). */
  flows(injectionsMW: Float64Array, out?: Float64Array): Float64Array;
  /**
   * Transfer factor matrix T[l*nb + k]: flow on l per unit transfer from the from-bus of k to its
   * to-bus. T[k*nb + k] is the share of that transfer carried by k itself.
   */
  transfer: Float64Array;
  /** LODF[l*nb + k]: change of flow on l per unit pre-outage flow on k, when k trips. */
  lodf: Float64Array;
  /** 1 where tripping the branch would split the network (radial or bridge). */
  islanding: Uint8Array;
  /** X = B^-1 (reduced, slack row/column zero), row-major n x n. */
  x: Float64Array;
  nBus: number;
}

export function buildSolver(nBus: number, branches: FlowBranch[], outaged: Set<number>, slack: number, baseMVA = 100): DCSolver {
  const nb = branches.length;
  // Connectivity from the slack through in-service branches.
  const adj: number[][] = Array.from({ length: nBus }, () => []);
  branches.forEach((b, i) => {
    if (outaged.has(i)) return;
    adj[b.from]!.push(i);
    adj[b.to]!.push(i);
  });
  const energised = new Uint8Array(nBus);
  const stack = [slack];
  energised[slack] = 1;
  while (stack.length) {
    const u = stack.pop()!;
    for (const i of adj[u]!) {
      const b = branches[i]!;
      const v = b.from === u ? b.to : b.from;
      if (!energised[v]) {
        energised[v] = 1;
        stack.push(v);
      }
    }
  }
  const active = new Uint8Array(nb);
  branches.forEach((b, i) => {
    active[i] = !outaged.has(i) && energised[b.from] && energised[b.to] ? 1 : 0;
  });

  // Reduced index: energised buses except slack.
  const red = new Int32Array(nBus).fill(-1);
  let m = 0;
  for (let i = 0; i < nBus; i++) if (energised[i] && i !== slack) red[i] = m++;
  const B = new Float64Array(m * m);
  branches.forEach((b, i) => {
    if (!active[i]) return;
    const y = 1 / b.x;
    const f = red[b.from]!;
    const t = red[b.to]!;
    if (f >= 0) B[f * m + f] = B[f * m + f]! + y;
    if (t >= 0) B[t * m + t] = B[t * m + t]! + y;
    if (f >= 0 && t >= 0) {
      B[f * m + t] = B[f * m + t]! - y;
      B[t * m + f] = B[t * m + f]! - y;
    }
  });
  const lu = new LU(B, m);
  const invRed = lu.inverse();
  // Expand to full bus indexing (slack and de-energised rows/cols zero).
  const X = new Float64Array(nBus * nBus);
  for (let i = 0; i < nBus; i++) {
    const ri = red[i]!;
    if (ri < 0) continue;
    for (let j = 0; j < nBus; j++) {
      const rj = red[j]!;
      if (rj < 0) continue;
      X[i * nBus + j] = invRed[ri * m + rj]!;
    }
  }

  const transfer = new Float64Array(nb * nb);
  for (let l = 0; l < nb; l++) {
    if (!active[l]) continue;
    const bl = branches[l]!;
    const fl = bl.from * nBus;
    const tl = bl.to * nBus;
    for (let k = 0; k < nb; k++) {
      if (!active[k]) continue;
      const bk = branches[k]!;
      const v = (X[fl + bk.from]! - X[fl + bk.to]! - (X[tl + bk.from]! - X[tl + bk.to]!)) / bl.x;
      transfer[l * nb + k] = v;
    }
  }
  const lodf = new Float64Array(nb * nb);
  const islanding = new Uint8Array(nb);
  for (let k = 0; k < nb; k++) {
    if (!active[k]) continue;
    const self = transfer[k * nb + k]!;
    const denom = 1 - self;
    if (denom < 1e-6) {
      islanding[k] = 1;
      continue;
    }
    for (let l = 0; l < nb; l++) {
      if (!active[l]) continue;
      lodf[l * nb + k] = l === k ? -1 : transfer[l * nb + k]! / denom;
    }
  }

  const theta = new Float64Array(m);
  const p = new Float64Array(m);
  return {
    energised,
    active,
    transfer,
    lodf,
    islanding,
    x: X,
    nBus,
    flows(inj, out = new Float64Array(nb)) {
      for (let i = 0; i < nBus; i++) {
        const r = red[i]!;
        if (r >= 0) p[r] = inj[i]! / baseMVA;
      }
      lu.solve(p, theta);
      for (let l = 0; l < nb; l++) {
        if (!active[l]) {
          out[l] = 0;
          continue;
        }
        const b = branches[l]!;
        const tf = red[b.from]! >= 0 ? theta[red[b.from]!]! : 0;
        const tt = red[b.to]! >= 0 ? theta[red[b.to]!]! : 0;
        out[l] = ((tf - tt) / b.x) * baseMVA;
      }
      return out;
    },
  };
}

/** Injection sensitivity: flow change on branch l per MW injected at bus i (withdrawn at the slack). */
export function ptdf(s: DCSolver, branches: FlowBranch[], l: number, bus: number): number {
  const b = branches[l]!;
  const n = s.nBus;
  return (s.x[b.from * n + bus]! - s.x[b.to * n + bus]!) / b.x;
}
