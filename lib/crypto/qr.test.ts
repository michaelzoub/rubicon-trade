import { describe, expect, it } from "vitest";
import { qrMatrix } from "./qr";

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1],
];
const block = (m: boolean[][], r0: number, c0: number) => FINDER.map((row, r) => row.map((_, c) => Number(m[r0 + r][c0 + c])));

describe("qrMatrix", () => {
  it("fits a wallet address in a version 3 symbol with finder patterns in three corners", () => {
    const m = qrMatrix("0x1111111111111111111111111111111111111111");
    expect(m.length).toBe(29);
    expect(m.every(row => row.length === 29)).toBe(true);
    expect(block(m, 0, 0)).toEqual(FINDER);
    expect(block(m, 0, 22)).toEqual(FINDER);
    expect(block(m, 22, 0)).toEqual(FINDER);
    // Timing patterns alternate between the finders; the dark module sits beside the bottom-left one.
    for (let i = 8; i < 21; i++) { expect(m[6][i]).toBe(i % 2 === 0); expect(m[i][6]).toBe(i % 2 === 0); }
    expect(m[21][8]).toBe(true);
  });

  it("grows the symbol with the payload and carries version bits from version 7", () => {
    expect(qrMatrix("hi").length).toBe(21);
    expect(qrMatrix("A".repeat(100)).length).toBe(41);
    const v9 = qrMatrix("B".repeat(180));
    expect(v9.length).toBe(53);
    // Version information is written twice and the copies mirror each other.
    for (let i = 0; i < 18; i++) expect(v9[Math.floor(i / 3)][53 - 11 + i % 3]).toBe(v9[53 - 11 + i % 3][Math.floor(i / 3)]);
    expect(() => qrMatrix("C".repeat(300))).toThrow(/too long/);
  });

  it("is deterministic and never leaves a module unset", () => {
    const a = qrMatrix("ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453"), b = qrMatrix("ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453");
    expect(a).toEqual(b);
    expect(a.flat().every(v => typeof v === "boolean")).toBe(true);
    // Roughly half the modules are dark after masking.
    const dark = a.flat().filter(Boolean).length / a.flat().length;
    expect(dark).toBeGreaterThan(.35); expect(dark).toBeLessThan(.65);
  });
});
