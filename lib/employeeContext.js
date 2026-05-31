import { db } from '../db.js';
import { getDbUser } from '../middleware/auth.js';
import { getEntityById, listEntities, getCompanyForAdmin } from './data.js';

export function ensureUserColumns() {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some((c) => c.name === 'employee_id')) {
    db.exec('ALTER TABLE users ADD COLUMN employee_id TEXT');
  }
}

export function findEmployeeByEmail(email, companyId = null) {
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  const matches = listEntities(
    'Employee',
    (e) =>
      e.email?.toLowerCase().trim() === normalized &&
      (!companyId || e.company_id === companyId)
  );
  return matches[0] || null;
}

export function getUserByEmployeeId(employeeId) {
  return db.prepare('SELECT * FROM users WHERE employee_id = ?').get(employeeId);
}

export function linkUserToEmployee(userId, employee) {
  const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  db.prepare('UPDATE users SET employee_id = ?, company_id = ?, full_name = ? WHERE id = ?').run(
    employee.id,
    employee.company_id,
    fullName || employee.email || '',
    userId
  );
}

export function getEmployeeContext(req) {
  const dbUser = getDbUser(req.user.sub);
  if (!dbUser) return null;

  let employee = dbUser.employee_id ? getEntityById('Employee', dbUser.employee_id) : null;

  if (!employee && dbUser.role === 'user') {
    employee = findEmployeeByEmail(dbUser.email, dbUser.company_id);
    if (employee) linkUserToEmployee(dbUser.id, employee);
  }

  if (!employee) return null;

  if (dbUser.company_id && employee.company_id !== dbUser.company_id) {
    return null;
  }

  return {
    dbUser,
    employee,
    employeeId: employee.id,
    companyId: employee.company_id,
  };
}

export function requireEmployeeContext(req, res) {
  const ctx = getEmployeeContext(req);
  if (!ctx) {
    res.status(403).json({
      error: 'No employee profile linked to this account. Ask your HR admin to invite you to the employee portal.',
    });
    return null;
  }
  return ctx;
}

export function requireAdminWithCompany(req, res) {
  const dbUser = getDbUser(req.user.sub);
  if (!dbUser) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (dbUser.role === 'super_admin') {
    return { dbUser, company: null, companyId: null, isSuperAdmin: true };
  }
  if (dbUser.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  const company = getCompanyForAdmin(dbUser);
  if (!company?.company_id) {
    res.status(403).json({ error: 'No company linked to this admin account' });
    return null;
  }
  return { dbUser, company, companyId: company.company_id, isSuperAdmin: false };
}

export function assertEmployeeInCompany(employee, companyId) {
  return employee && employee.company_id === companyId;
}
