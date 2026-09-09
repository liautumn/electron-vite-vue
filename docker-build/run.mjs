import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [target, action, ...extraArgs] = process.argv.slice(2);

if (!['linux', 'win'].includes(target) || !['install', 'build'].includes(action)) {
  console.error('Usage: node docker-build/run.mjs <linux|win> <install|build> [npm arguments]');
  process.exit(1);
}

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const command = action === 'install'
  ? ['npm', 'install', ...extraArgs]
  : ['npm', 'run', `build:${target}`, '--', '--x64', ...extraArgs];

const result = spawnSync('docker', [
  'run', '--rm', '--platform', 'linux/amd64',
  '--mount', `type=bind,source=${projectDir},target=/project`,
  // Do not populate a new dependency volume with host-native node_modules.
  '--mount', `type=volume,source=electron-builder-${target}-amd64-node-modules,target=/project/node_modules,volume-nocopy`,
  '--workdir', '/project',
  `electron-builder:node24-${target}-amd64`,
  ...command,
], {
  cwd: projectDir,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Unable to start Docker: ${result.error.message}`);
}

process.exit(result.status ?? 1);
