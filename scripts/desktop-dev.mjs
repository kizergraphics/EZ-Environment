import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ configFile: 'vite.app.config.js', server: { host: '127.0.0.1', port: 5173, strictPort: false } });
await server.listen();
const address = server.httpServer.address();
const env = { ...process.env, EZ_ENVIRONMENT_DEV_URL: `http://127.0.0.1:${address.port}` };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['desktop/main.cjs'], { stdio: 'inherit', env, windowsHide: true });
child.on('exit', async code => { await server.close(); process.exit(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
