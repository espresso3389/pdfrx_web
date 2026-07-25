import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const docsDirectory = resolve('docs-site');
const sourceDocsDirectory = resolve('docs');
const publicPrefix = 'https://espresso3389.github.io/pdfrx_web/';
const githubDocsPrefix = 'https://github.com/espresso3389/pdfrx_web/blob/master/docs/';
const copiedDocs = new Set();
let rewritten = 0;

for (const file of await htmlFiles(docsDirectory)) {
  const source = await readFile(file, 'utf8');
  const links = [...source.matchAll(/href="(https:\/\/(?:espresso3389\.github\.io\/pdfrx_web\/|github\.com\/espresso3389\/pdfrx_web\/blob\/master\/docs\/)[^"]*)"/g)];
  let output = source;
  for (const match of links) {
    const url = match[1];
    if (!url) continue;
    const isSourceDoc = url.startsWith(githubDocsPrefix);
    const suffix = url.slice(isSourceDoc ? githubDocsPrefix.length : publicPrefix.length);
    const [pathAndQuery, fragment] = suffix.split('#', 2);
    const [pathPart, query] = (pathAndQuery ?? '').split('?', 2);
    if (!pathPart) continue;
    const decodedParts = decodeURIComponent(pathPart).split('/');
    const target = resolve(docsDirectory, ...(isSourceDoc ? ['docs', ...decodedParts] : decodedParts));
    const sourceDoc = isSourceDoc ? resolve(sourceDocsDirectory, ...decodedParts) : undefined;
    if (!target.startsWith(`${docsDirectory}${sep}`) && target !== docsDirectory) continue;
    try {
      if (sourceDoc) {
        if (!sourceDoc.startsWith(`${sourceDocsDirectory}${sep}`) || !(await stat(sourceDoc)).isFile()) continue;
        if (!copiedDocs.has(sourceDoc)) {
          await mkdir(dirname(target), { recursive: true });
          await copyFile(sourceDoc, target);
          copiedDocs.add(sourceDoc);
        }
      } else if (!(await stat(target)).isFile()) {
        continue;
      }
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

console.log(
  `Rewrote ${rewritten} generated links to local relative paths and copied ${copiedDocs.size} source document(s).`,
);

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}
