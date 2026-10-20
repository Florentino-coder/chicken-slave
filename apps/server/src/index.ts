import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultStatic = path.resolve(here, '../../web/dist');

const server = createApp({ staticDir: process.env.STATIC_DIR ?? defaultStatic });

server.listen().then((port) => {
  console.log(`[chicken-slave] server listening on http://localhost:${port}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    console.log(`[chicken-slave] ${sig}, shutting down`);
    await server.close();
    process.exit(0);
  });
}
