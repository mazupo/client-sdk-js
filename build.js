const esbuild = require('esbuild');

// React is a peer dependency, so it is never bundled: two copies of it in one page break hooks.
const external = ['react', 'react/jsx-runtime'];

// ESM only. Bundlers reach these through the "browser" condition and a script tag loads them
// as a module; Node and anything asking for CommonJS gets the tsc output under build/ instead.
// Minified because these ship to browsers as they are, including from a CDN.
const bundles = [
  { in: 'src/index.ts', out: 'dist/index.esm.js' },
  { in: 'src/gamepad/index.ts', out: 'dist/gamepad.esm.js' },
  { in: 'src/gamepad/react/index.ts', out: 'dist/gamepad-react.esm.js' },
];

// Not under dist/: that directory ships, and a test bundle has no business there.
const tests = [
  { in: 'test/ipc-body.test.ts', out: '.test-build/ipc-body.cjs' },
  { in: 'test/gamepad.test.ts', out: '.test-build/gamepad.cjs' },
  { in: 'test/gamepad-react.test.tsx', out: '.test-build/gamepad-react.cjs' },
  { in: 'test/max-bitrate.test.ts', out: '.test-build/max-bitrate.cjs' },
];

async function run() {
  for (const bundle of bundles) {
    await esbuild.build({
      bundle: true,
      platform: 'browser',
      format: 'esm',
      minify: true,
      sourcemap: false,
      external,
      entryPoints: [bundle.in],
      outfile: bundle.out,
    });
  }

  if (process.argv.includes('--test')) {
    for (const test of tests) {
      await esbuild.build({
        bundle: true,
        platform: 'node',
        target: 'node18',
        format: 'cjs',
        entryPoints: [test.in],
        outfile: test.out,
      });
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
