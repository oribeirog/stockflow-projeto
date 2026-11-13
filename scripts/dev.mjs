import { spawn, spawnSync } from 'node:child_process';
import electron from 'electron';
import { environment } from './env.mjs';
const env = environment({ MNR_DEV: '1', MNR_DEV_SUPERVISED: '1' });
const build = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'],
  { stdio: 'inherit', env },
);
if (build.status !== 0) process.exit(build.status ?? 1);
await import('./preload.mjs');
const server = spawn(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'serve'], {
  stdio: 'inherit',
  env,
});
let desktop;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  desktop?.kill();
  server.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('exit', (code) => stop(code ?? 0));
try {
  let ready = false;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:4200/');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Server is starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Angular did not start within 60 seconds.');
  const launchDesktop = () => {
    if (stopping) return;
    let relaunch = false;
    const current = spawn(electron, ['.', ...process.argv.slice(2)], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env,
    });
    desktop = current;
    current.on('message', (message) => {
      if (
        message &&
        typeof message === 'object' &&
        Object.keys(message).length === 1 &&
        'type' in message &&
        message.type === 'mnr:relaunch' &&
        !relaunch &&
        !stopping &&
        current.connected
      ) {
        relaunch = true;
        current.send({ type: 'mnr:relaunch-ready' }, () => {});
      }
    });
    desktop.on('exit', (code) => {
      if (relaunch && code === 0 && !stopping && server.exitCode === null) launchDesktop();
      else stop(code ?? 0);
    });
    desktop.on('error', (error) => {
      console.error(error);
      stop(1);
    });
  };
  launchDesktop();
} catch (error) {
  console.error(error);
  stop(1);
}
