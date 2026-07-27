import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const docsDirectory = resolve('docs-site');
const publicPrefix = 'https://espresso3389.github.io/pdfrx_web/';
let rewritten = 0;

for (const file of await htmlFiles(docsDirectory)) {
  const source = await readFile(file, 'utf8');
  const links = [...source.matchAll(/href="(https:\/\/espresso3389\.github\.io\/pdfrx_web\/[^"]*)"/g)];
  let output = source;
  for (const match of links) {
    const url = match[1];
    if (!url) continue;
    const suffix = url.slice(publicPrefix.length);
    const [pathAndQuery, fragment] = suffix.split('#', 2);
    const [pathPart, query] = (pathAndQuery ?? '').split('?', 2);
    if (!pathPart) continue;
    const decodedParts = decodeURIComponent(pathPart).split('/');
    const target = resolve(docsDirectory, ...decodedParts);
    if (!target.startsWith(`${docsDirectory}${sep}`) && target !== docsDirectory) continue;
    try {
      if (!(await stat(target)).isFile()) continue;
    } catch {
      continue;
    }
    const localPath = relative(dirname(file), target).split(sep).join('/') || '.';
    const localUrl = `${localPath}${query === undefined ? '' : `?${query}`}${fragment === undefined ? '' : `#${fragment}`}`;
    output = output.replaceAll(`href="${url}"`, `href="${localUrl}"`);
    rewritten++;
  }
  if (output !== source) await writeFile(file, output, 'utf8');
}

console.log(`Rewrote ${rewritten} generated API links to local relative paths.`);

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}
