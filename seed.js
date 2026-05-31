import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db, initDb } from './db.js';

initDb();

const email = process.env.SEED_SUPER_ADMIN_EMAIL || 'admin@comp-rite.local';
const password = process.env.SEED_SUPER_ADMIN_PASSWORD || 'admin123';

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.log(`Super admin already exists: ${email}`);
  process.exit(0);
}

const id = uuidv4();
db.prepare(
  'INSERT INTO users (id, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)'
).run(id, email, bcrypt.hashSync(password, 10), 'Super Admin', 'super_admin');

console.log('Super admin created:');
console.log(`  Email:    ${email}`);
console.log(`  Password: ${password}`);
console.log('Change this password after first login.');
