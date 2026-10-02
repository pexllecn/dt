/**
 * Dense linear algebra for a few hundred buses. LU with partial pivoting; the reduced
 * susceptance matrix is symmetric positive definite for a connected network, so this is stable.
 */
export class LU {
  readonly n: number;
  private readonly a: Float64Array;
  private readonly piv: Int32Array;
  readonly singular: boolean;

  constructor(matrix: Float64Array, n: number) {
    this.n = n;
    this.a = new Float64Array(matrix);
    this.piv = new Int32Array(n);
    const a = this.a;
    let singular = false;
    for (let i = 0; i < n; i++) this.piv[i] = i;
    for (let k = 0; k < n; k++) {
      let p = k;
      let max = Math.abs(a[k * n + k]!);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(a[i * n + k]!);
        if (v > max) {
          max = v;
          p = i;
        }
      }
      if (max < 1e-12) {
        singular = true;
        continue;
      }
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          const t = a[k * n + j]!;
          a[k * n + j] = a[p * n + j]!;
          a[p * n + j] = t;
        }
        const t = this.piv[k]!;
        this.piv[k] = this.piv[p]!;
        this.piv[p] = t;
      }
      const akk = a[k * n + k]!;
      for (let i = k + 1; i < n; i++) {
        const f = a[i * n + k]! / akk;
        a[i * n + k] = f;
        if (f === 0) continue;
        const ri = i * n;
        const rk = k * n;
        for (let j = k + 1; j < n; j++) a[ri + j] = a[ri + j]! - f * a[rk + j]!;
      }
    }
    this.singular = singular;
  }

  solve(b: Float64Array, out = new Float64Array(this.n)): Float64Array {
    const n = this.n;
    const a = this.a;
    for (let i = 0; i < n; i++) out[i] = b[this.piv[i]!]!;
    for (let i = 0; i < n; i++) {
      let s = out[i]!;
      const ri = i * n;
      for (let j = 0; j < i; j++) s -= a[ri + j]! * out[j]!;
      out[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = out[i]!;
      const ri = i * n;
      for (let j = i + 1; j < n; j++) s -= a[ri + j]! * out[j]!;
      out[i] = s / a[ri + i]!;
    }
    return out;
  }

  /** Full inverse, row-major. */
  inverse(): Float64Array {
    const n = this.n;
    const inv = new Float64Array(n * n);
    const e = new Float64Array(n);
    const col = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      e.fill(0);
      e[j] = 1;
      this.solve(e, col);
      for (let i = 0; i < n; i++) inv[i * n + j] = col[i]!;
    }
    return inv;
  }
}
