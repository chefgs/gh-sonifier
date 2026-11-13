/**
 * Zips dist/ext for the Chrome Web Store.
 *
 * The archive must have manifest.json at its root, not inside a folder, so the zip is
 * made from *inside* dist/ext. -X drops the macOS extended attributes and resource forks
 * that otherwise show up as __MACOSX entries and can fail review.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'dist', 'ext');

if (!existsSync(join(source, 'manifest.json'))) {
  console.error('dist/ext/manifest.json is missing. Run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outDir = join(root, 'dist');
const zipPath = join(outDir, `contribution-sonifier-${pkg.version}.zip`);

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

// cwd is dist/ext, so paths inside the archive are relative to it.
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: source });

const listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
  .split('\n')
  .filter((line) => line !== '');

if (!listing.includes('manifest.json')) {
  console.error('manifest.json is not at the root of the archive. The store will reject it.');
  process.exit(1);
}
for (const entry of listing) {
  if (entry.startsWith('__MACOSX') || entry.endsWith('.DS_Store')) {
    console.error(`unexpected entry in the archive: ${entry}`);
    process.exit(1);
  }
}

const size = statSync(zipPath).size;
console.log(`packaged ${zipPath.replace(`${root}/`, '')} (${Math.ceil(size / 1024)} KB, ${listing.length} entries)`);
for (const entry of listing.sort()) console.log(`  ${entry}`);
