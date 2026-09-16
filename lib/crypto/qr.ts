/** A small QR encoder: byte mode, error-correction level M, versions 1–10 (up to 213 bytes).
 * Enough for a wallet address, with no dependency. Returns a square matrix where `true` is a dark module. */

type Block = { count: number; dataWords: number };
/** Per version: total codewords, EC codewords per block, and block groups at level M. */
const VERSIONS: { total: number; ec: number; groups: Block[] }[] = [
  { total: 26, ec: 10, groups: [{ count: 1, dataWords: 16 }] },
  { total: 44, ec: 16, groups: [{ count: 1, dataWords: 28 }] },
  { total: 70, ec: 26, groups: [{ count: 1, dataWords: 44 }] },
  { total: 100, ec: 18, groups: [{ count: 2, dataWords: 32 }] },
  { total: 134, ec: 24, groups: [{ count: 2, dataWords: 43 }] },
  { total: 172, ec: 16, groups: [{ count: 4, dataWords: 27 }] },
  { total: 196, ec: 18, groups: [{ count: 4, dataWords: 31 }] },
  { total: 242, ec: 22, groups: [{ count: 2, dataWords: 38 }, { count: 2, dataWords: 39 }] },
  { total: 292, ec: 22, groups: [{ count: 3, dataWords: 36 }, { count: 2, dataWords: 37 }] },
  { total: 346, ec: 26, groups: [{ count: 4, dataWords: 43 }, { count: 1, dataWords: 44 }] },
];

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => a && b ? EXP[LOG[a] + LOG[b]] : 0;

function reedSolomon(data: number[], ecWords: number): number[] {
  let gen = [1];
  for (let i = 0; i < ecWords; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= mul(g, EXP[i]); });
    gen = next;
  }
  const rem = new Array<number>(ecWords).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    if (factor) gen.slice(1).forEach((g, j) => { rem[j] ^= mul(g, factor); });
  }
  return rem;
}

function bch(value: number, poly: number, bits: number): number {
  const shift = 31 - Math.clz32(poly);
  let rem = value << (shift);
  for (let i = bits - 1; i >= shift; i--) if (rem >> i & 1) rem ^= poly << (i - shift);
  return (value << shift) | rem;
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const versionIndex = VERSIONS.findIndex(v => v.groups.reduce((n, g) => n + g.count * g.dataWords, 0) >= bytes.length + 2);
  if (versionIndex < 0) throw new Error("Text is too long for this QR encoder.");
  const version = versionIndex + 1, spec = VERSIONS[versionIndex];
  const size = version * 4 + 17;
  const dataCapacity = spec.groups.reduce((n, g) => n + g.count * g.dataWords, 0);

  // Bit stream: mode 0100, 8-bit length, bytes, terminator, then pad words.
  const bits: number[] = [];
  const push = (value: number, count: number) => { for (let i = count - 1; i >= 0; i--) bits.push(value >> i & 1); };
  push(0b0100, 4); push(bytes.length, 8); bytes.forEach(b => push(b, 8));
  push(0, Math.min(4, dataCapacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCapacity; pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, then interleave data and EC codewords.
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const g of spec.groups) for (let i = 0; i < g.count; i++) { const d = data.slice(offset, offset + g.dataWords); offset += g.dataWords; blocks.push({ data: d, ec: reedSolomon(d, spec.ec) }); }
  const words: number[] = [];
  const longest = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.data.length) words.push(b.data[i]);
  for (let i = 0; i < spec.ec; i++) for (const b of blocks) words.push(b.ec[i]);

  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, dark: boolean) => { modules[r][c] = dark; reserved[r][c] = true; };

  // Finder patterns with separators.
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const edge = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, edge !== 2 && edge !== 4);
    }
  }
  // Timing patterns and the dark module.
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  set(size - 8, 8, true);
  // Alignment patterns.
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
    const centers = [6];
    for (let pos = size - 7; centers.length < count; pos -= step) centers.splice(1, 0, pos);
    for (const r of centers) for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  // Reserve format areas (version info only appears from version 7).
  for (let i = 0; i < 8; i++) { reserved[8][i] = reserved[i][8] = reserved[8][size - 1 - i] = reserved[size - 1 - i][8] = true; }
  reserved[8][8] = true;
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { reserved[i][size - 11 + j] = reserved[size - 11 + j][i] = true; }

  // Place data in the zigzag, skipping the vertical timing column.
  let bit = 0, upward = true;
  const stream = words.flatMap(w => Array.from({ length: 8 }, (_, i) => w >> (7 - i) & 1));
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) if (!reserved[row][c]) modules[row][c] = (stream[bit++] ?? 0) === 1;
    }
    upward = !upward;
  }

  const masks: ((r: number, c: number) => boolean)[] = [
    (r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (_, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];
  const apply = (mask: number) => modules.map((row, r) => row.map((dark, c) => reserved[r][c] ? dark : dark !== masks[mask](r, c)));
  const writeFormat = (grid: boolean[][], mask: number) => {
    const format = bch((0b00 << 3) | mask, 0x537, 15) ^ 0x5412;
    for (let i = 0; i < 15; i++) {
      const dark = (format >> i & 1) === 1;
      if (i < 6) grid[i][8] = dark; else if (i < 8) grid[i + 1][8] = dark; else if (i === 8) grid[8][7] = dark; else grid[8][14 - i] = dark;
      if (i < 8) grid[8][size - 1 - i] = dark; else grid[size - 15 + i][8] = dark;
    }
    if (version >= 7) {
      const info = bch(version, 0x1f25, 18);
      for (let i = 0; i < 18; i++) { const dark = (info >> i & 1) === 1; grid[Math.floor(i / 3)][size - 11 + i % 3] = dark; grid[size - 11 + i % 3][Math.floor(i / 3)] = dark; }
    }
    return grid;
  };

  let best: boolean[][] | null = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = writeFormat(apply(mask), mask);
    const score = penalty(grid);
    if (score < bestScore) { best = grid; bestScore = score; }
  }
  return best!;
}

function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0, dark = 0;
  const finder = [true, false, true, true, true, false, true];
  for (let i = 0; i < size; i++) {
    let runRow = 1, runCol = 1;
    for (let j = 0; j < size; j++) {
      if (grid[i][j]) dark++;
      if (j > 0) {
        if (grid[i][j] === grid[i][j - 1]) { runRow++; if (runRow === 5) score += 3; else if (runRow > 5) score++; } else runRow = 1;
        if (grid[j][i] === grid[j - 1][i]) { runCol++; if (runCol === 5) score += 3; else if (runCol > 5) score++; } else runCol = 1;
      }
      if (i < size - 1 && j < size - 1 && grid[i][j] === grid[i][j + 1] && grid[i][j] === grid[i + 1][j] && grid[i][j] === grid[i + 1][j + 1]) score += 3;
      if (j + 11 <= size) {
        const row = finder.every((v, k) => grid[i][j + k] === v), col = finder.every((v, k) => grid[j + k][i] === v);
        const lightRow = (from: number) => [0, 1, 2, 3].every(k => j + from + k < size && j + from + k >= 0 && !grid[i][j + from + k]);
        const lightCol = (from: number) => [0, 1, 2, 3].every(k => j + from + k < size && j + from + k >= 0 && !grid[j + from + k][i]);
        if (row && (lightRow(7) || lightRow(-4))) score += 40;
        if (col && (lightCol(7) || lightCol(-4))) score += 40;
      }
    }
  }
  const percent = dark * 100 / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}
