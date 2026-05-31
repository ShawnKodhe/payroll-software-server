import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db, parseEntityRow } from '../db.js';
import { authRequired, getDbUser } from '../middleware/auth.js';
import { generatePayslipPdf } from '../services/payslip.js';

const router = Router();

function requireRole(req, roles) {
  const user = getDbUser(req.user.sub);
  if (!user || !roles.includes(user.role)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return user;
}

function getEntity(type, filter) {
  const rows = db.prepare('SELECT * FROM entities WHERE entity_type = ?').all(type);
  return rows.map(parseEntityRow).find((r) =>
    Object.entries(filter).every(([k, v]) => r[k] === v)
  );
}

router.post('/registerCompany', async (req, res) => {
  try {
    const body = req.body;
    const { company_name, admin_email, admin_name, kra_pin, registration_number, industry, phone, email, address, plan } = body;

    if (!company_name || !admin_email || !admin_name) {
      return res.status(400).json({ error: 'Missing required fields: company_name, admin_email, admin_name' });
    }

    const company_id =
      company_name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') +
      '_' +
      Date.now().toString(36);

    const trialExpires = new Date();
    trialExpires.setDate(trialExpires.getDate() + 14);
    const now = new Date().toISOString();
    const id = uuidv4();

    const companyData = {
      company_name,
      company_id,
      admin_email: admin_email.toLowerCase().trim(),
      admin_name,
      kra_pin: kra_pin || '',
      registration_number: registration_number || '',
      industry: industry || '',
      phone: phone || '',
      email: email || '',
      address: address || '',
      plan: plan || 'free_trial',
      status: 'active',
      trial_expires_at: trialExpires.toISOString().split('T')[0],
      created_date: now,
    };

    db.prepare(
      'INSERT INTO entities (id, entity_type, data, created_date) VALUES (?, ?, ?, ?)'
    ).run(id, 'Company', JSON.stringify(companyData), now);

    const normalizedAdminEmail = admin_email.toLowerCase().trim();
    let adminUser = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedAdminEmail);
    let temporary_password = null;

    if (!adminUser) {
      temporary_password =
        req.body.admin_password ||
        `${company_id.slice(0, 8)}!${Date.now().toString(36).slice(-4)}`;
      const userId = uuidv4();
      db.prepare(
        'INSERT INTO users (id, email, password_hash, full_name, role, company_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        userId,
        normalizedAdminEmail,
        bcrypt.hashSync(temporary_password, 10),
        admin_name,
        'admin',
        company_id
      );
      adminUser = { id: userId };
    } else {
      db.prepare('UPDATE users SET role = ?, company_id = ?, full_name = ? WHERE email = ?').run(
        'admin',
        company_id,
        admin_name,
        normalizedAdminEmail
      );
    }

    res.json({
      success: true,
      company: { id, ...companyData },
      admin_email: normalizedAdminEmail,
      temporary_password: req.body.admin_password ? undefined : temporary_password,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/generatePayslip', authRequired, async (req, res) => {
  try {
    const { payroll_item_id, payroll_run_id } = req.body;
    if (!payroll_item_id) {
      return res.status(400).json({ error: 'payroll_item_id is required' });
    }
    const result = generatePayslipPdf({ payroll_item_id, payroll_run_id });
    res.json(result);
  } catch (error) {
    res.status(error.message === 'PayrollItem not found' ? 404 : 500).json({ error: error.message });
  }
});

router.post('/notifyLeaveApproval', authRequired, async (req, res) => {
  try {
    const { leave_id, status } = req.body;
    if (!leave_id || !status) {
      return res.status(400).json({ error: 'Missing leave_id or status' });
    }

    const leave = getEntity('LeaveRequest', { id: leave_id });
    if (!leave) return res.status(404).json({ error: 'Leave request not found' });

    const isApproved = status === 'approved';
    const statusLabel = isApproved ? 'Approved' : 'Rejected';
    const employeeName = leave.employee_name;

    const empRows = db.prepare("SELECT * FROM entities WHERE entity_type = 'Employee'").all();
    const employees = empRows.map(parseEntityRow);
    const employeeEmail = employees.find(
      (e) => `${e.first_name} ${e.last_name}`.trim() === employeeName.trim()
    )?.email;

    const notifId = uuidv4();
    const now = new Date().toISOString();
    const notifData = {
      title: `Leave Request ${statusLabel}`,
      message: `Your ${leave.leave_type?.replace('_', ' ')} leave from ${leave.start_date} to ${leave.end_date} (${leave.days || 0} days) has been ${status}.`,
      type: isApproved ? 'success' : 'error',
      category: 'hr',
      recipient_email: employeeEmail || '',
      is_read: false,
      created_date: now,
    };

    db.prepare(
      'INSERT INTO entities (id, entity_type, data, created_date) VALUES (?, ?, ?, ?)'
    ).run(notifId, 'Notification', JSON.stringify(notifData), now);

    res.json({ success: true, email_sent: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/inviteCompanyAdmin', authRequired, async (req, res) => {
  try {
    requireRole(req, ['super_admin']);
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.toLowerCase().trim();
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

    if (existing) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', existing.id);
      return res.json({ success: true, already_registered: true });
    }

    const tempPassword = uuidv4().slice(0, 12);
    const id = uuidv4();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)'
    ).run(id, normalizedEmail, bcrypt.hashSync(tempPassword, 10), normalizedEmail.split('@')[0], 'admin');

    res.json({
      success: true,
      invite_password: tempPassword,
      message: 'Admin user created. Share the temporary password securely.',
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/updateUserRole', authRequired, async (req, res) => {
  try {
    requireRole(req, ['super_admin']);
    const { userId, role } = req.body;
    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/initiateMpesaPayment', authRequired, async (req, res) => {
  res.json({
    success: true,
    demo: true,
    CheckoutRequestID: `demo_${Date.now()}`,
    message: 'Local mode: M-Pesa not configured. Subscription can be activated manually.',
  });
});

router.post('/processCardPayment', authRequired, async (req, res) => {
  const { cardNumber, cardExpiry, cardCvv, cardName } = req.body;
  if (!cardNumber || cardNumber.length < 13) {
    return res.json({ success: false, error: 'Invalid card number' });
  }
  if (!cardExpiry || !cardCvv || !cardName) {
    return res.json({ success: false, error: 'Missing card details' });
  }
  res.json({
    success: true,
    demo: true,
    last4: cardNumber.slice(-4),
    message: 'Local mode: Card payment simulated.',
  });
});

export default router;
