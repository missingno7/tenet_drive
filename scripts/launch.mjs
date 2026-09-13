import { spawn } from 'node:child_process';
const url = `http://127.0.0.1:${Number(process.env.PORT || 5173)}`;
function openBrowser() {
  const opener = process.platform === 'win32' ? spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }) : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  opener.on('error', () => console.log(`Open ${url} in your browser.`));
}
try {
  const existing = await fetch(url, { signal: AbortSignal.timeout(700) });
  if ((await existing.text()).includes('<title>Tenet Drive</title>')) {
    console.log(`Tenet Drive is already running: ${url}`);
    openBrowser();
    process.exit(0);
  }
} catch { /* No existing game server; launch one below. */ }
const server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true });
let opened = false;
server.stdout.on('data', data => {
  process.stdout.write(data);
  if (!opened && data.toString().includes('Tenet Drive ready:')) {
    opened = true;
    openBrowser();
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 0; });
process.on('SIGINT', () => server.kill('SIGINT'));
