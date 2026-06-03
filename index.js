import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import entityRoutes from './routes/entities.js';
import functionRoutes from './routes/functions.js';
import integrationRoutes from './routes/integrations.js';
import essRoutes from './routes/ess.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3002;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

initDb();

const app = express();
app.use(cors({ origin: [CLIENT_ORIGIN, 'http://localhost:4173'], credentials: true }));
app.use(cors({ origin: [CLIENT_ORIGIN, 'https://payroll-software-ten.vercel.app/'], credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Comprite' });
});

app.use('/api/auth', authRoutes);
app.use('/api/entities', entityRoutes);
app.use('/api/functions', functionRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/ess', essRoutes);
app.use('/api/admin', adminRoutes);

const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Comprite API running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "Payroll API is running 🚀"
  });
});
