/** Front-coded blocks, byte phoneme IDs; only the requested reading is expanded. */
export class Dictionary {
  readonly count: number;
  private phones: string[];
  private blockSize: number;
  private offsets: Uint32Array;
  private data: Uint8Array;
  private readings: Uint8Array;
  private decoder = new TextDecoder();
  constructor(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (this.decoder.decode(bytes.subarray(0, 4)) !== "BNE1")
      throw new Error("Invalid dictionary format");
    const size = view.getUint32(4, true);
    const header = JSON.parse(this.decoder.decode(bytes.subarray(8, 8 + size)));
    this.phones = header.phones;
    this.count = header.count;
    this.blockSize = header.blockSize;
    if (
      !Number.isInteger(this.count) ||
      this.count < 1 ||
      this.blockSize !== 32 ||
      !Array.isArray(this.phones)
    )
      throw new Error("Invalid dictionary header");
    const blocks = Math.ceil(this.count / this.blockSize);
    this.offsets = new Uint32Array((blocks + 1) * 2);
    for (let i = 0; i < (blocks + 1) * 2; i++)
      this.offsets[i] = view.getUint32(8 + size + i * 4, true);
    const start = 8 + size + (blocks + 1) * 8;
    this.data = bytes.subarray(start, start + this.offsets[blocks * 2]);
    this.readings = bytes.subarray(start + this.offsets[blocks * 2]);
    if (this.offsets[blocks * 2 + 1] !== this.readings.length)
      throw new Error("Truncated dictionary");
  }
  private first(block: number) {
    const start = this.offsets[block * 2];
    return this.decoder.decode(
      this.data.subarray(start + 2, start + 2 + this.data[start + 1]),
    );
  }
  get(word: string): string[][] | undefined {
    let low = 0,
      high = this.offsets.length / 2 - 2;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.first(mid) <= word) low = mid + 1;
      else high = mid - 1;
    }
    if (high < 0) return;
    let at = this.offsets[high * 2],
      readingAt = this.offsets[high * 2 + 1],
      previous = "";
    const end = this.offsets[(high + 1) * 2];
    while (at < end) {
      const prefix = this.data[at++],
        length = this.data[at++];
      const name =
        previous.slice(0, prefix) +
        this.decoder.decode(this.data.subarray(at, at + length));
      at += length;
      if (name > word) return;
      const readings = this.readings[readingAt++],
        result: string[][] = [];
      for (let i = 0; i < readings; i++) {
        const count = this.readings[readingAt++];
        if (name === word)
          result.push(
            Array.from(
              this.readings.subarray(readingAt, readingAt + count),
              (p) => this.phones[p],
            ),
          );
        readingAt += count;
      }
      if (name === word) return result;
      previous = name;
    }
  }
}
