import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { authRequired, signToken, getDbUser, userToMe } from '../middleware/auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password', status: 401 });
  }

  const token = signToken(user);
  res.json({ token, user: userToMe(user) });
});

router.post('/register', (req, res) => {
  const { email, password, full_name, role = 'user', company_id } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, full_name, role, company_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, normalizedEmail, password_hash, full_name || '', role, company_id || null);

  const user = getDbUser(id);
  const token = signToken(user);
  res.status(201).json({ token, user: userToMe(user) });
});

router.get('/me', authRequired, (req, res) => {
  const user = getDbUser(req.user.sub);
  if (!user) return res.status(401).json({ error: 'User not found', status: 401 });
  res.json(userToMe(user));
});

router.get('/is-authenticated', authRequired, (req, res) => {
  res.json({ authenticated: true });
});

export default router;
