/**
 * Builds the unpacked extension into dist/ext.
 *
 * esbuild is a build-time dependency only: the output has no runtime dependency on
 * anything, and no code is downloaded at runtime.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIcons } from './icons.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'dist', 'ext');

const banner = '/* Contribution Sonifier - built from source in src/. No runtime dependencies. */\n';

async function main() {
  await rm(join(root, 'dist'), { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const result = await build({
    entryPoints: {
      app: join(root, 'src', 'ui', 'app.ts'),
      sw: join(root, 'src', 'ext', 'sw.ts'),
    },
    outdir: out,
    bundle: true,
    format: 'esm',
    target: ['chrome116'],
    platform: 'browser',
    sourcemap: false,
    minify: process.env.NO_MINIFY !== '1',
    legalComments: 'none',
    banner: { js: banner },
    metafile: true,
    // Nothing should be left external: an external import would be a runtime dependency.
    external: [],
  });

  await cp(join(root, 'src', 'ui', 'app.html'), join(out, 'app.html'));
  await cp(join(root, 'src', 'ui', 'app.css'), join(out, 'app.css'));
  await cp(join(root, 'src', 'ext', 'manifest.json'), join(out, 'manifest.json'));

  const icons = writeIcons(join(out, 'icons'));

  // Keep the manifest version and package version from drifting apart.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifestPath = join(out, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== pkg.version) {
    manifest.version = pkg.version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const files = [];
  for (const name of await readdir(out, { recursive: true })) {
    const path = join(out, name);
    if ((await stat(path)).isFile()) files.push([name, (await stat(path)).size]);
  }

  console.log(`built dist/ext (${files.length} files)`);
  for (const [name, size] of files.sort()) {
    console.log(`  ${String(Math.ceil(size / 1024)).padStart(5)} KB  ${name}`);
  }
  console.log(`  icons: ${icons.length}`);
  if (result.metafile === undefined) return;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
