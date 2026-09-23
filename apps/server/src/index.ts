// @opencli/server - entry point
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(OpenCLI server running on http://localhost:);
});
