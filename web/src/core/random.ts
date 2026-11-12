/** CPython integer-seeded MT19937, including getrandbits/_randbelow semantics. */
export class PythonRandom {
  private mt = new Uint32Array(624);
  private index = 624;
  constructor(seed: string | number | bigint = 42) {
    if (typeof seed === "number" && !Number.isSafeInteger(seed))
      throw new Error("Use a decimal string for a large integer seed");
    let value: bigint;
    try {
      value = BigInt(seed);
    } catch {
      throw new Error("Seed must be an integer");
    }
    if (value < 0n) value = -value;
    const key: number[] = [];
    do {
      key.push(Number(value & 0xffffffffn));
      value >>= 32n;
    } while (value);
    this.mt[0] = 19650218;
    for (let i = 1; i < 624; i++)
      this.mt[i] =
        (Math.imul(1812433253, this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)) +
          i) >>>
        0;
    let i = 1,
      j = 0;
    for (let k = Math.max(624, key.length); k; k--) {
      this.mt[i] =
        ((this.mt[i] ^
          Math.imul(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1664525)) +
          key[j] +
          j) >>>
        0;
      if (++i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
      if (++j >= key.length) j = 0;
    }
    for (let k = 623; k; k--) {
      this.mt[i] =
        ((this.mt[i] ^
          Math.imul(this.mt[i - 1] ^ (this.mt[i - 1] >>> 30), 1566083941)) -
          i) >>>
        0;
      if (++i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
  }
  uint32(): number {
    if (this.index >= 624) {
      for (let i = 0; i < 624; i++) {
        const y =
          (this.mt[i] & 0x80000000) | (this.mt[(i + 1) % 624] & 0x7fffffff);
        this.mt[i] =
          this.mt[(i + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
  random(): number {
    return (
      ((this.uint32() >>> 5) * 67108864 + (this.uint32() >>> 6)) /
      9007199254740992
    );
  }
  getrandbits(bits: number): number {
    if (bits <= 32) return this.uint32() >>> (32 - bits);
    return this.uint32() + (this.uint32() >>> (64 - bits)) * 4294967296;
  }
  randbelow(n: number): number {
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new Error("Random bound must be a positive safe integer");
    const bits = Math.floor(Math.log2(n)) + 1;
    let value;
    do {
      value = this.getrandbits(bits);
    } while (value >= n);
    return value;
  }
}
