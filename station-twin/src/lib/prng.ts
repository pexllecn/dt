/** xoshiro128** seeded generator. The simulation never calls Math.random. */
export interface Prng {
  next(): number;
  state(): [number, number, number, number];
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createPrng(seed: number, from?: [number, number, number, number]): Prng {
  let s: [number, number, number, number];
  if (from) s = [...from];
  else {
    const sm = splitmix32(seed);
    s = [sm(), sm(), sm(), sm()];
  }
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return {
    next() {
      const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
      const t = (s[1] << 9) >>> 0;
      s[2] ^= s[0];
      s[3] ^= s[1];
      s[1] ^= s[2];
      s[0] ^= s[3];
      s[2] ^= t;
      s[3] = rotl(s[3], 11);
      return result / 4294967296;
    },
    state: () => [...s],
  };
}
