import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { config, seedQuestions } from '@proof/server-core';
import { createApp } from './app.ts';

seedQuestions();
const app = createApp();
// Serve the built web app when present (npm run build). In development Vite serves the UI and proxies /api here.
const dist = path.resolve(import.meta.dirname, '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_q, s) => s.sendFile(path.join(dist, 'index.html')));
}
app.listen(config.PORT, () => console.log(`API on http://localhost:${config.PORT}  (AI evaluator: ${config.aiMode})`));
