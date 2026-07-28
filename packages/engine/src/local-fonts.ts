// Server-runtime local font discovery. Node-compatible imports are assembled
// dynamically so browser bundlers do not pull filesystem shims into the engine.

export interface PdfrxLocalFontsOptions {
  /** Search the conventional font directories for the current OS. Default: true. */
  systemDirectories?: boolean;
  /** Additional directories to search recursively. */
  directories?: readonly string[];
  /** Cache the font metadata index on disk. Default: true when `fontCache.directory` is set. */
  indexCache?: boolean;
}

export interface PdfrxFontCacheOptions {
  /** Directory used for the local-font metadata index and registered font data. */
  directory: string;
  /** Persist bytes supplied through `PdfrxEngine.addFontData`. Default: false. */
  persistRegisteredFonts?: boolean;
}

interface FontRecord {
  path: string;
  names: string[];
  weight: number;
  italic: boolean;
  size: number;
  mtimeMs: number;
}

interface NodeModules {
  fs: {
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    mkdir(path: string, options: { recursive: true }): Promise<void>;
    readdir(path: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>>;
    stat(path: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean }>;
  };
  path: {
    join(...parts: string[]): string;
    resolve(path: string): string;
  };
  os: { homedir(): string; platform(): string };
}

const dynamicImport = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);

async function nodeModules(): Promise<NodeModules> {
  const [fs, path, os] = await Promise.all([
    dynamicImport('node:fs/promises'),
    dynamicImport('node:path'),
    dynamicImport('node:os'),
  ]);
  return { fs, path, os } as NodeModules;
}

export function isServerRuntime(): boolean {
  return typeof document === 'undefined';
}

/** Conventional per-machine and per-user font directories. */
export async function systemFontDirectories(): Promise<string[]> {
  const { os, path } = await nodeModules();
  const home = os.homedir();
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  switch (os.platform()) {
    case 'win32':
      return [
        path.join(env['WINDIR'] ?? 'C:\\Windows', 'Fonts'),
        path.join(env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts'),
      ];
    case 'darwin':
      return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library', 'Fonts')];
    default: {
      const dataHome = env['XDG_DATA_HOME'] ?? path.join(home, '.local', 'share');
      const dataDirs = (env['XDG_DATA_DIRS'] ?? '/usr/local/share:/usr/share').split(':');
      return [
        path.join(dataHome, 'fonts'),
        path.join(home, '.fonts'),
        ...dataDirs.map((directory) => path.join(directory, 'fonts')),
      ];
    }
  }
}

const u16 = (data: Uint8Array, offset: number): number | undefined =>
  offset + 2 <= data.length ? ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0) : undefined;
const u32 = (data: Uint8Array, offset: number): number | undefined => {
  if (offset + 4 > data.length) return undefined;
  return (((data[offset] ?? 0) * 0x1000000) +
    ((data[offset + 1] ?? 0) << 16) +
    ((data[offset + 2] ?? 0) << 8) +
    (data[offset + 3] ?? 0)) >>> 0;
};

function tableOffset(data: Uint8Array, tag: string, sfntOffset: number): number | undefined {
  const count = u16(data, sfntOffset + 4);
  if (count === undefined) return undefined;
  for (let i = 0; i < count; i++) {
    const record = sfntOffset + 12 + i * 16;
    const actualTag = String.fromCharCode(...data.subarray(record, record + 4));
    if (actualTag === tag) return u32(data, record + 8);
  }
  return undefined;
}

function decodeName(data: Uint8Array, platform: number): string {
  if (platform === 0 || platform === 3) {
    let value = '';
    for (let i = 0; i + 1 < data.length; i += 2) {
      value += String.fromCharCode(((data[i] ?? 0) << 8) | (data[i + 1] ?? 0));
    }
    return value.replace(/\0/g, '').trim();
  }
  return new TextDecoder('latin1').decode(data).replace(/\0/g, '').trim();
}

function fontMetadata(data: Uint8Array): { names: string[]; weight: number; italic: boolean } | null {
  const sfntOffset = u32(data, 0) === 0x74746366 ? u32(data, 12) : 0;
  if (sfntOffset === undefined) return null;
  const nameOffset = tableOffset(data, 'name', sfntOffset);
  if (nameOffset === undefined) return null;
  const count = u16(data, nameOffset + 2);
  const stringsOffset = u16(data, nameOffset + 4);
  if (count === undefined || stringsOffset === undefined) return null;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    const record = nameOffset + 6 + i * 12;
    const platform = u16(data, record);
    const nameId = u16(data, record + 6);
    const length = u16(data, record + 8);
    const offset = u16(data, record + 10);
    if (platform === undefined || length === undefined || offset === undefined || ![1, 4, 6, 16, 17].includes(nameId ?? -1)) continue;
    const start = nameOffset + stringsOffset + offset;
    const value = decodeName(data.subarray(start, start + length), platform);
    if (value) names.add(value);
  }
  const os2 = tableOffset(data, 'OS/2', sfntOffset);
  const weight = os2 === undefined ? 400 : (u16(data, os2 + 4) ?? 400);
  const head = tableOffset(data, 'head', sfntOffset);
  const macStyle = head === undefined ? 0 : (u16(data, head + 44) ?? 0);
  return names.size ? { names: [...names], weight, italic: (macStyle & 2) !== 0 } : null;
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9\u0080-\uffff]/g, '');

export class LocalFontManager {
  private records: FontRecord[] | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly options: PdfrxLocalFontsOptions,
    private readonly cache: PdfrxFontCacheOptions | undefined,
  ) {}

  async loadRegistered(): Promise<Array<{ face: string; data: Uint8Array; resolvedFace?: string }>> {
    if (!this.cache?.persistRegisteredFonts) return [];
    const modules = await nodeModules();
    try {
      const directory = modules.path.join(this.cache.directory, 'registered');
      const manifest = JSON.parse(
        new TextDecoder().decode(await modules.fs.readFile(modules.path.join(directory, 'manifest.json'))),
      ) as Array<{ face: string; file: string; resolvedFace?: string }>;
      return await Promise.all(
        manifest.map(async (entry) => ({
          face: entry.face,
          data: await modules.fs.readFile(modules.path.join(directory, entry.file)),
          ...(entry.resolvedFace !== undefined ? { resolvedFace: entry.resolvedFace } : {}),
        })),
      );
    } catch {
      return [];
    }
  }

  async persistRegistered(face: string, data: Uint8Array, resolvedFace?: string): Promise<void> {
    if (!this.cache?.persistRegisteredFonts) return;
    const ownedData = new Uint8Array(data).slice();
    const write = this.persistQueue.then(() => this.persistRegisteredNow(face, ownedData, resolvedFace));
    this.persistQueue = write.catch(() => {});
    return write;
  }

  private async persistRegisteredNow(face: string, data: Uint8Array, resolvedFace?: string): Promise<void> {
    const cache = this.cache;
    if (!cache?.persistRegisteredFonts) return;
    const modules = await nodeModules();
    const directory = modules.path.join(cache.directory, 'registered');
    const manifestPath = modules.path.join(directory, 'manifest.json');
    await modules.fs.mkdir(directory, { recursive: true });
    let manifest: Array<{ face: string; file: string; resolvedFace?: string }> = [];
    try {
      manifest = JSON.parse(new TextDecoder().decode(await modules.fs.readFile(manifestPath))) as typeof manifest;
    } catch {
      // First registration.
    }
    const file = `${encodeURIComponent(face)}.font`;
    await modules.fs.writeFile(modules.path.join(directory, file), data);
    const record = { face, file, ...(resolvedFace !== undefined ? { resolvedFace } : {}) };
    const index = manifest.findIndex((entry) => entry.face === face);
    if (index < 0) manifest.push(record);
    else manifest[index] = record;
    await modules.fs.writeFile(manifestPath, JSON.stringify(manifest));
  }

  async resolve(query: { face: string; weight: number; italic: boolean }): Promise<{ data: Uint8Array; resolvedFace: string } | null> {
    const records = await this.loadIndex();
    const wanted = normalize(query.face);
    const candidates = records.filter((record) => record.names.some((name) => normalize(name) === wanted));
    if (!candidates.length) return null;
    candidates.sort((a, b) =>
      Number(a.italic !== query.italic) - Number(b.italic !== query.italic) ||
      Math.abs(a.weight - query.weight) - Math.abs(b.weight - query.weight),
    );
    const selected = candidates[0];
    if (!selected) return null;
    const { fs } = await nodeModules();
    return { data: await fs.readFile(selected.path), resolvedFace: selected.names[0] ?? query.face };
  }

  private async loadIndex(): Promise<FontRecord[]> {
    if (this.records) return this.records;
    const modules = await nodeModules();
    const cacheFile = this.cache ? modules.path.join(this.cache.directory, 'local-font-index.json') : null;
    if (cacheFile && (this.options.indexCache ?? true)) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(await modules.fs.readFile(cacheFile))) as { records?: FontRecord[] };
        if (Array.isArray(parsed.records)) {
          const valid = await Promise.all(parsed.records.map(async (record) => {
            try {
              const stat = await modules.fs.stat(record.path);
              return stat.isFile() && stat.size === record.size && stat.mtimeMs === record.mtimeMs;
            } catch {
              return false;
            }
          }));
          if (valid.every(Boolean)) {
            this.records = parsed.records;
            return this.records;
          }
        }
      } catch {
        // Missing or invalid cache: rebuild it.
      }
    }
    const directories = [
      ...(this.options.systemDirectories ?? true ? await systemFontDirectories() : []),
      ...(this.options.directories ?? []),
    ];
    const records: FontRecord[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await modules.fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const file = modules.path.join(directory, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(file);
        else if (entry.isFile() && /\.(?:ttf|otf|ttc)$/i.test(entry.name)) {
          try {
            const [data, stat] = await Promise.all([modules.fs.readFile(file), modules.fs.stat(file)]);
            const metadata = fontMetadata(data);
            if (metadata) records.push({ path: modules.path.resolve(file), ...metadata, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch {
            // An unreadable or malformed font must not disable the remaining directories.
          }
        }
      }
    };
    for (const directory of [...new Set(directories)]) await visit(directory);
    this.records = records;
    if (cacheFile && (this.options.indexCache ?? true)) {
      await modules.fs.mkdir(this.cache!.directory, { recursive: true });
      await modules.fs.writeFile(cacheFile, JSON.stringify({ version: 1, records }));
    }
    return records;
  }
}
