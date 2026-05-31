import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, parseEntityRow, transaction } from '../db.js';
import { authOptional, authRequired, getDbUser } from '../middleware/auth.js';
import { getCompanyForAdmin } from '../lib/data.js';

const EMPLOYEE_ESS_ENTITIES = new Set(['PayrollItem', 'PayrollRun', 'LeaveRequest']);

const router = Router();

const VALID_TYPES = new Set([
  'Company', 'Employee', 'Department', 'PayrollRun', 'PayrollItem',
  'PayrollComponent', 'LeaveRequest', 'Notification', 'Shareholder',
  'Client', 'Subscription', 'User',
]);

function parseSort(sortArg) {
  if (!sortArg) return { field: 'created_date', desc: true };
  const desc = String(sortArg).startsWith('-');
  const field = desc ? String(sortArg).slice(1) : String(sortArg);
  return { field, desc };
}

function matchesFilter(record, filter) {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter).every(([key, value]) => {
    if (value === undefined || value === null) return true;
    return record[key] === value;
  });
}

function canAccessEntity(user, entityType, record, action) {
  if (!user) return action === 'read' && entityType === 'Company';
  const dbUser = getDbUser(user.sub);
  if (!dbUser) return false;
  if (dbUser.role === 'super_admin') return true;

  if (entityType === 'User') {
    return false;
  }

  if (dbUser.role === 'user') {
    if (EMPLOYEE_ESS_ENTITIES.has(entityType)) return false;
    if (entityType === 'Employee') {
      return (
        action !== 'delete' &&
        (record?.id === dbUser.employee_id || record?.email === dbUser.email)
      );
    }
    if (entityType === 'Notification') {
      return action === 'read' && record?.recipient_email === dbUser.email;
    }
    return false;
  }

  if (entityType === 'Company') {
    if (action === 'create') return true;
    return record?.admin_email === dbUser.email;
  }

  let companyId = dbUser.company_id;
  if (dbUser.role === 'admin' && !companyId) {
    companyId = getCompanyForAdmin(dbUser)?.company_id;
  }
  const recordCompanyId = record?.company_id;

  if (companyId && recordCompanyId) {
    return recordCompanyId === companyId;
  }

  if (!recordCompanyId && ['Department', 'PayrollComponent', 'Notification'].includes(entityType)) {
    return dbUser.role === 'admin';
  }

  return dbUser.role === 'admin';
}

function listUsers(sort, limit) {
  let users = db
    .prepare('SELECT id, email, full_name, role, company_id, employee_id, created_date FROM users')
    .all();
  users = users.map(u => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    created_date: u.created_date,
  }));
  const { field, desc } = parseSort(sort);
  users.sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
  if (limit) users = users.slice(0, Number(limit));
  return users;
}

router.use(authOptional);

router.get('/:entityType', (req, res) => {
  const { entityType } = req.params;
  if (!VALID_TYPES.has(entityType)) {
    return res.status(400).json({ error: `Unknown entity: ${entityType}` });
  }

  const filter = req.query.filter ? JSON.parse(req.query.filter) : {};
  const sort = req.query.sort;
  const limit = req.query.limit ? Number(req.query.limit) : null;

  if (entityType === 'User') {
    if (!req.user || getDbUser(req.user.sub)?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json(listUsers(sort, limit));
  }

  const rows = db.prepare('SELECT * FROM entities WHERE entity_type = ?').all(entityType);
  let records = rows.map(parseEntityRow).filter(r => matchesFilter(r, filter));
  records = records.filter(r => canAccessEntity(req.user, entityType, r, 'read'));

  const { field, desc } = parseSort(sort);
  records.sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });

  if (limit) records = records.slice(0, limit);
  res.json(records);
});

router.post('/:entityType', authRequired, (req, res) => {
  const { entityType } = req.params;
  if (!VALID_TYPES.has(entityType) || entityType === 'User') {
    return res.status(400).json({ error: `Cannot create entity: ${entityType}` });
  }

  const body = req.body;
  const id = body.id || uuidv4();
  const now = new Date().toISOString();
  const { id: _omit, created_date, updated_date, ...rest } = body;
  const data = { ...rest, created_date: created_date || now };

  if (!canAccessEntity(req.user, entityType, data, 'create')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  db.prepare(
    'INSERT INTO entities (id, entity_type, data, created_date) VALUES (?, ?, ?, ?)'
  ).run(id, entityType, JSON.stringify(data), data.created_date);

  res.status(201).json({ id, ...data });
});

router.post('/:entityType/bulk', authRequired, (req, res) => {
  const { entityType } = req.params;
  const items = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Expected array of items' });
  }

  const insert = db.prepare(
    'INSERT INTO entities (id, entity_type, data, created_date) VALUES (?, ?, ?, ?)'
  );
  const created = [];
  const now = new Date().toISOString();

  transaction(() => {
    for (const item of items) {
      const id = item.id || uuidv4();
      const { id: _omit, created_date, updated_date, ...rest } = item;
      const data = { ...rest, created_date: created_date || now };
      if (!canAccessEntity(req.user, entityType, data, 'create')) continue;
      insert.run(id, entityType, JSON.stringify(data), data.created_date);
      created.push({ id, ...data });
    }
  });

  res.status(201).json(created);
});

router.patch('/:entityType/:id', authRequired, (req, res) => {
  const { entityType, id } = req.params;
  const row = db.prepare('SELECT * FROM entities WHERE id = ? AND entity_type = ?').get(id, entityType);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const existing = parseEntityRow(row);
  if (!canAccessEntity(req.user, entityType, existing, 'update')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const updated = { ...existing, ...req.body, id };
  delete updated.created_date;
  const data = { ...existing };
  Object.assign(data, req.body);
  data.id = id;
  const now = new Date().toISOString();
  data.updated_date = now;

  db.prepare('UPDATE entities SET data = ?, updated_date = ? WHERE id = ?').run(
    JSON.stringify(data),
    now,
    id
  );

  res.json({ id, ...data, created_date: existing.created_date });
});

router.delete('/:entityType/:id', authRequired, (req, res) => {
  const { entityType, id } = req.params;
  const row = db.prepare('SELECT * FROM entities WHERE id = ? AND entity_type = ?').get(id, entityType);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const existing = parseEntityRow(row);
  if (!canAccessEntity(req.user, entityType, existing, 'delete')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  db.prepare('DELETE FROM entities WHERE id = ?').run(id);
  res.json({ success: true });
});

export default router;
