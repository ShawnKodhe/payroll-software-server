import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, parseEntityRow } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { requireEmployeeContext } from '../lib/employeeContext.js';
import { getEntityById, listEntities } from '../lib/data.js';
import { generatePayslipPdf } from '../services/payslip.js';

const router = Router();

router.use(authRequired);

router.get('/me', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;

  const { dbUser, employee, companyId } = ctx;
  const company = listEntities('Company', (c) => c.company_id === companyId)[0];

  res.json({
    user: {
      id: dbUser.id,
      email: dbUser.email,
      full_name: dbUser.full_name,
      role: dbUser.role,
      employee_id: employee.id,
      company_id: companyId,
    },
    employee,
    company: company
      ? { company_id: company.company_id, company_name: company.company_name }
      : { company_id: companyId },
  });
});

router.get('/payslips', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;

  const items = listEntities(
    'PayrollItem',
    (item) => item.employee_id === ctx.employeeId
  ).sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));

  const runIds = [...new Set(items.map((i) => i.payroll_run_id).filter(Boolean))];
  const runs = {};
  for (const runId of runIds) {
    const run = getEntityById('PayrollRun', runId);
    if (run && run.company_id === ctx.companyId) {
      runs[runId] = {
        id: run.id,
        period: run.period,
        period_label: run.period_label,
        status: run.status,
      };
    }
  }

  const scopedItems = items.filter((item) => {
    if (!item.payroll_run_id) return true;
    return !!runs[item.payroll_run_id];
  });

  res.json({ items: scopedItems, runs });
});

router.get('/payslips/:payrollItemId/pdf', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;

  const item = getEntityById('PayrollItem', req.params.payrollItemId);
  if (!item || item.employee_id !== ctx.employeeId) {
    return res.status(404).json({ error: 'Payslip not found' });
  }

  if (item.payroll_run_id) {
    const run = getEntityById('PayrollRun', item.payroll_run_id);
    if (run && run.company_id !== ctx.companyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  try {
    const result = generatePayslipPdf({
      payroll_item_id: item.id,
      payroll_run_id: item.payroll_run_id,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leave', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;

  const leaves = listEntities(
    'LeaveRequest',
    (l) => l.employee_id === ctx.employeeId && l.company_id === ctx.companyId
  ).sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));

  res.json(leaves);
});

router.post('/leave', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;

  const { leave_type, start_date, end_date, days, reason, notes } = req.body;
  if (!leave_type || !start_date || !end_date) {
    return res.status(400).json({ error: 'leave_type, start_date, and end_date are required' });
  }

  const { employee } = ctx;
  const now = new Date().toISOString();
  const id = uuidv4();
  const data = {
    leave_type,
    start_date,
    end_date,
    days: days ?? 0,
    reason: reason || '',
    notes: notes || '',
    status: 'pending',
    employee_id: ctx.employeeId,
    company_id: ctx.companyId,
    employee_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
    created_date: now,
  };

  db.prepare(
    'INSERT INTO entities (id, entity_type, data, created_date) VALUES (?, ?, ?, ?)'
  ).run(id, 'LeaveRequest', JSON.stringify(data), now);

  res.status(201).json({ id, ...data });
});

router.patch('/leave/:id', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;

  const existing = getEntityById('LeaveRequest', req.params.id);
  if (
    !existing ||
    existing.employee_id !== ctx.employeeId ||
    existing.company_id !== ctx.companyId
  ) {
    return res.status(404).json({ error: 'Leave request not found' });
  }

  if (req.body.status !== 'cancelled') {
    return res.status(400).json({ error: 'Employees can only cancel pending requests' });
  }
  if (existing.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending requests can be cancelled' });
  }

  const data = { ...existing, status: 'cancelled', updated_date: new Date().toISOString() };
  db.prepare('UPDATE entities SET data = ?, updated_date = ? WHERE id = ?').run(
    JSON.stringify(data),
    data.updated_date,
    req.params.id
  );

  res.json({ id: req.params.id, ...data });
});

router.get('/profile', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;
  res.json(ctx.employee);
});

const EDITABLE_PROFILE_FIELDS = [
  'phone',
  'address',
  'emergency_contact_name',
  'emergency_contact_phone',
  'bank_name',
  'bank_account',
  'bank_branch',
];

router.patch('/profile', (req, res) => {
  const ctx = requireEmployeeContext(req, res);
  if (!ctx) return;

  const row = db
    .prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?')
    .get('Employee', ctx.employeeId);
  if (!row) return res.status(404).json({ error: 'Employee not found' });

  const existing = parseEntityRow(row);
  const data = { ...existing };
  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (req.body[field] !== undefined) data[field] = req.body[field];
  }
  data.updated_date = new Date().toISOString();

  db.prepare('UPDATE entities SET data = ?, updated_date = ? WHERE id = ?').run(
    JSON.stringify(data),
    data.updated_date,
    ctx.employeeId
  );

  res.json({ id: ctx.employeeId, ...data });
});

export default router;
