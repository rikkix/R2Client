import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const monaco = path.dirname(require.resolve('monaco-editor/package.json'));
// Resolve from React-PDF so its API and worker always have matching versions.
const pdf = path.dirname(
  require.resolve('pdfjs-dist/package.json', {
    paths: [path.dirname(require.resolve('react-pdf'))],
  })
);
const destination = path.join(root, 'public/vendor');
await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, 'pdfjs'), { recursive: true });
await cp(path.join(monaco, 'min/vs'), path.join(destination, 'monaco/vs'), { recursive: true });
for (const name of ['LICENSE', 'ThirdPartyNotices.txt']) {
  await cp(path.join(monaco, name), path.join(destination, 'monaco', name));
}
await cp(
  path.join(pdf, 'build/pdf.worker.min.mjs'),
  path.join(destination, 'pdfjs/pdf.worker.min.mjs')
);
await cp(path.join(pdf, 'LICENSE'), path.join(destination, 'pdfjs/LICENSE'));
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(pdf, name), path.join(destination, 'pdfjs', name), { recursive: true });
}
console.log('Prepared local Monaco and PDF.js assets.');
