import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import path from 'node:path';

// CPU-only diagnostic: no Electron, browser, graphics context, or source rebuild.
// Replay the exact immutable browser worker bundle in independent Node workers.
const source = path.resolve('artifacts/performance/soak-report.json');
const soak = JSON.parse(await readFile(source, 'utf8'));
const bundle = soak.bundles.find(item => item.file.startsWith('placement.worker-'));
const code = await readFile(path.join(soak.snapshot, 'assets', bundle.file), 'utf8');
const seed = Number(process.argv.find(arg => arg.startsWith('--seed='))?.split('=')[1] || 18430);
const cycles = Number(process.argv.find(arg => arg.startsWith('--cycles='))?.split('=')[1] || 50);
const results = [];
const workerCode = `const { parentPort, workerData } = require('node:worker_threads');
globalThis.self = { postMessage: ({ result, error }) => parentPort.postMessage({ hash: result?.hash, count: result?.count, error }) };
${code}
self.onmessage({ data: { id: 1, options: workerData } });`;
for (let cycle = 0; cycle < cycles; cycle++) {
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, { eval: true, workerData: { ...soak.options, quality: 'high', seed } });
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code) reject(new Error(`Worker exit ${code}`)); });
  });
  if (result.error) throw new Error(result.error);
  results.push(result);
  if (cycle % 10 === 0) console.log(JSON.stringify({ cycle, ...result }));
}
const report = { date: new Date().toISOString(), scope: 'CPU-only Node worker replay of frozen browser placement bundle; not an Electron-browser determinism guarantee.', node: process.version, v8: process.versions.v8, source, bundle, seed, cycles, hashes: [...new Set(results.map(result => result.hash))], results };
await writeFile(path.resolve('artifacts/performance/placement-worker-replay.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cycles, hashes: report.hashes }));
