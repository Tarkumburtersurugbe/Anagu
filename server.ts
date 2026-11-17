import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './server/db.ts';
import { rateLimit } from './server/auth.ts';
import { apiRouter } from './server/routes.ts';

const PORT = 3000;

async function startServer() {
  initDatabase();

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', rateLimit(180, 60_000), apiRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ANAGU Land Administration Server', timestamp: new Date().toISOString() });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ANAGU Digital Land Administration server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ANAGU server:', err);
  process.exit(1);
});
