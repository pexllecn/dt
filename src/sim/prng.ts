/** xoshiro128** seeded generator. Deterministic across platforms. */
export class Prng {
  private s = new Uint32Array(4);

  constructor(seed: number) {
    // splitmix32 to fill the state
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }

  next(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1]!, 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1]! << 9) >>> 0;
    s[2] = s[2]! ^ s[0]!;
    s[3] = s[3]! ^ s[1]!;
    s[1] = s[1]! ^ s[2]!;
    s[0] = s[0]! ^ s[3]!;
    s[2] = s[2]! ^ t;
    s[3] = rotl(s[3]!, 11);
    return result / 4294967296;
  }

  /** Approximately normal (sum of uniforms). */
  gauss(): number {
    return this.next() + this.next() + this.next() + this.next() - 2;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Smooth seeded noise in one dimension (value noise with cosine interpolation). */
export function noise1(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    let x = (Math.imul(n ^ seed, 0x27d4eb2d) ^ (n >>> 15)) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0x165667b1) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  const u = (1 - Math.cos(Math.PI * f)) / 2;
  return h(i) * (1 - u) + h(i + 1) * u;
}
