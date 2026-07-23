import { spawn, type ChildProcess } from 'node:child_process';

const processes: ChildProcess[] = [];

if (await isExpectedHttpServer('http://127.0.0.1:5191/api/health', (text) => text.includes('"ok":true'))) {
  console.log('Reusing the existing collaboration relay on port 5191.');
} else {
  await assertPortAvailable('http://127.0.0.1:5191/api/health', 5191);
  processes.push(spawn('bun', ['--watch', 'server/main.ts'], { stdio: 'inherit' }));
}

if (await isExpectedHttpServer('http://127.0.0.1:5173/', (text) =>
  text.includes('/src/main.tsx') && text.includes('pdfrx collaboration'))) {
  console.log('Reusing the existing collaboration client on port 5173.');
} else {
  await assertPortAvailable('http://127.0.0.1:5173/', 5173);
  processes.push(spawn('bun', ['x', 'vite'], { stdio: 'inherit' }));
}

if (processes.length === 0) {
  console.log('The collaboration client and relay are already running.');
  await new Promise(() => undefined);
}

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  for (const child of processes) child.kill();
};

for (const child of processes) {
  child.once('exit', (code) => {
    if (!stopping && code !== 0) process.exitCode = code ?? 1;
    stop();
  });
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function isExpectedHttpServer(url: string, accepts: (text: string) => boolean): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok && accepts(await response.text());
  } catch {
    return false;
  }
}

async function assertPortAvailable(url: string, port: number): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    throw new Error(`Port ${port} is occupied by an unexpected process.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('unexpected process')) throw error;
  }
}
