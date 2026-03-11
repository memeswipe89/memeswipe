const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const patches = [
  {
    src: path.join(projectRoot, 'patches', 'uuid-wrapper.mjs'),
    dest: path.join(
      projectRoot,
      'node_modules',
      '@privy-io',
      'js-sdk-core',
      'node_modules',
      'uuid',
      'wrapper.mjs'
    ),
  },
];

function copyPatch({ src, dest }) {
  if (!fs.existsSync(src)) {
    throw new Error(`Patch source not found: ${src}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Applied patch: ${path.relative(projectRoot, dest)}`);
}

for (const patch of patches) {
  copyPatch(patch);
}
