import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalFontManager, systemFontDirectories } from './local-fonts.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('server local fonts', () => {
  it('detects conventional directories for the current operating system', async () => {
    const directories = await systemFontDirectories();
    expect(directories.length).toBeGreaterThan(0);
    expect(directories.every((directory) => directory.length > 0)).toBe(true);
  });

  it('persists and restores explicitly registered font bytes when enabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pdfrx-fonts-'));
    temporaryDirectories.push(directory);
    const manager = new LocalFontManager(
      { systemDirectories: false },
      { directory, persistRegisteredFonts: true },
    );
    await manager.persistRegistered('Example Sans', new Uint8Array([1, 2, 3]), 'ExampleSans-Regular');

    const restored = await manager.loadRegistered();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.face).toBe('Example Sans');
    expect(Array.from(restored[0]?.data ?? [])).toEqual([1, 2, 3]);
    expect(restored[0]?.resolvedFace).toBe('ExampleSans-Regular');
    expect(await readFile(join(directory, 'registered', 'manifest.json'), 'utf8')).toContain('Example Sans');
  });

  it('returns no match when all configured directories are absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pdfrx-fonts-'));
    temporaryDirectories.push(directory);
    const manager = new LocalFontManager({
      systemDirectories: false,
      directories: [join(directory, 'missing')],
    }, undefined);

    await expect(manager.resolve({ face: 'Missing Font', weight: 400, italic: false })).resolves.toBeNull();
  });
});
