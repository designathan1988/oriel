import { describe, expect, it } from 'vitest';
import { crc32, unzipStore, zipStore } from '../../src/f3/io/zip';

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes files that read back byte for byte, names in UTF-8', () => {
    const bin = new Uint8Array(1000).map((_, i) => (i * 37) & 255);
    const z = zipStore([
      { name: 'game.json', data: '{"a":1}' },
      { name: 'buildings/préd io.glb', data: bin },
    ]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    const back = unzipStore(z);
    expect(back.map((f) => f.name)).toEqual(['game.json', 'buildings/préd io.glb']);
    expect(new TextDecoder().decode(back[0]!.data)).toBe('{"a":1}');
    expect([...back[1]!.data]).toEqual([...bin]);
    // Same input, same bytes.
    expect([...zipStore([{ name: 'a', data: 'x' }])]).toEqual([...zipStore([{ name: 'a', data: 'x' }])]);
  });
});
