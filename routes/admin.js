import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import {
  requireAdminWithCompany,
  assertEmployeeInCompany,
  getUserByEmployeeId,
} from '../lib/employeeContext.js';
import { getEntityById } from '../lib/data.js';

const router = Router();

router.use(authRequired);

function generateTempPassword(employee) {
  const slug = (employee.employee_id || 'emp')
    .toString()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8);
  return `${slug || 'emp'}!${Date.now().toString(36).slice(-4)}`;
}

router.get('/employees/:employeeId/portal', (req, res) => {
  const admin = requireAdminWithCompany(req, res);
  if (!admin) return;

  const employee = getEntityById('Employee', req.params.employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  if (!admin.isSuperAdmin && !assertEmployeeInCompany(employee, admin.companyId)) {
    return res.status(403).json({ error: 'Employee is not in your company' });
  }

  const portalUser = getUserByEmployeeId(employee.id);
  const userByEmail = employee.email
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(employee.email.toLowerCase().trim())
    : null;

  res.json({
    employee_id: employee.id,
    has_portal_access: !!(portalUser || userByEmail),
    portal_email: portalUser?.email || userByEmail?.email || employee.email,
    invited: !!(portalUser?.employee_id === employee.id),
  });
});

router.post('/employees/:employeeId/invite', (req, res) => {
  const admin = requireAdminWithCompany(req, res);
  if (!admin) return;

  const employee = getEntityById('Employee', req.params.employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  if (!admin.isSuperAdmin && !assertEmployeeInCompany(employee, admin.companyId)) {
    return res.status(403).json({ error: 'Employee is not in your company' });
  }

  if (!employee.email) {
    return res.status(400).json({ error: 'Employee must have an email address before inviting to the portal' });
  }

  const email = employee.email.toLowerCase().trim();
  const tempPassword = req.body.password || generateTempPassword(employee);
  const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();

  let existing = getUserByEmployeeId(employee.id);
  if (!existing) {
    existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }

  if (existing) {
    db.prepare(
      'UPDATE users SET email = ?, password_hash = ?, role = ?, company_id = ?, employee_id = ?, full_name = ? WHERE id = ?'
    ).run(
      email,
      bcrypt.hashSync(tempPassword, 10),
      'user',
      employee.company_id,
      employee.id,
      fullName || existing.full_name,
      existing.id
    );

    return res.json({
      success: true,
      already_registered: true,
      email,
      temporary_password: tempPassword,
      message: 'Portal access updated. Share the new temporary password with the employee.',
    });
  }

  const userId = uuidv4();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, full_name, role, company_id, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    userId,
    email,
    bcrypt.hashSync(tempPassword, 10),
    fullName,
    'user',
    employee.company_id,
    employee.id
  );

  res.status(201).json({
    success: true,
    email,
    temporary_password: tempPassword,
    message: 'Employee invited. Share the temporary password securely; they sign in at /login.',
  });
});

export default router;
