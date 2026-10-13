import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name: string) => readFileSync(path.join(root, name), 'utf8');

test('personal build has no updater registration, permission, endpoint, or reporting UI', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  expect(config.bundle.createUpdaterArtifacts).toBe(false);
  expect(config.plugins?.updater).toBeUndefined();
  const permissions = JSON.stringify(JSON.parse(read('src-tauri/capabilities/default.json')));
  expect(permissions).not.toContain('updater:');
  expect(permissions).not.toContain('process:allow-restart');
  for (const file of ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/src/lib.rs']) {
    expect(read(file)).not.toContain('plugin-updater');
    expect(read(file)).not.toContain('plugin_updater');
  }
  for (const file of [
    'src/app/components/StatusBar.tsx',
    'src/app/components/CommandPalette.tsx',
    'src/app/components/TransferErrorModal.tsx',
    'src/app/page.tsx',
    'src/app/providers.tsx',
  ]) {
    expect(read(file)).not.toContain('ReportProblem');
    expect(read(file)).not.toContain('reportStore');
    expect(read(file)).not.toContain('installSessionLog');
  }
  expect(existsSync(path.join(root, 'src/app/components/UpdateChecker.tsx'))).toBe(false);
  expect(existsSync(path.join(root, 'src/app/lib/report'))).toBe(false);
});

test('viewer assets and build telemetry settings stay local', () => {
  const pdf = read('src/app/components/preview/PDFViewer.tsx');
  const text = read('src/app/components/preview/TextViewer.tsx');
  expect(pdf).toContain("workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'");
  expect(text).toContain("vs: '/vendor/monaco/vs'");
  for (const file of [
    pdf,
    text,
    read('src/app/components/SettingsModal.tsx'),
    read('src-tauri/src/lib.rs'),
  ]) {
    expect(file).not.toContain('https://');
  }
  expect(read('src/app/layout.tsx')).not.toContain('next/font/google');
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const name of ['dev', 'build']) {
    expect(scripts[name]).toContain('prepare:assets');
    expect(scripts[name]).toContain('NEXT_TELEMETRY_DISABLED=1');
  }
});
