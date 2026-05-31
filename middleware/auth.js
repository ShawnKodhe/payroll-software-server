import jwt from 'jsonwebtoken';
import { db } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'comprite-local-dev-secret-change-in-production';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

export function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    req.user = null;
    next();
  }
}

export function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', status: 401 });
    }
    next();
  });
}

export function getDbUser(userId) {
  return db
    .prepare(
      'SELECT id, email, full_name, role, company_id, employee_id, created_date FROM users WHERE id = ?'
    )
    .get(userId);
}

export function userToMe(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name || user.email.split('@')[0],
    role: user.role || 'user',
    employee_id: user.employee_id || null,
    company_id: user.company_id || null,
    data: {
      company_id: user.company_id || null,
      employee_id: user.employee_id || null,
    },
  };
}
