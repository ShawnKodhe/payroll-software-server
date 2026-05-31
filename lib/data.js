import { db, parseEntityRow } from '../db.js';

export function getEntityById(entityType, id) {
  const row = db
    .prepare('SELECT * FROM entities WHERE entity_type = ? AND id = ?')
    .get(entityType, id);
  return parseEntityRow(row);
}

export function listEntities(entityType, predicate = () => true) {
  const rows = db.prepare('SELECT * FROM entities WHERE entity_type = ?').all(entityType);
  return rows.map(parseEntityRow).filter(predicate);
}

export function getCompanyForAdmin(dbUser) {
  if (dbUser.company_id) {
    const bySlug = listEntities('Company', (c) => c.company_id === dbUser.company_id);
    if (bySlug[0]) return bySlug[0];
  }
  const byEmail = listEntities('Company', (c) => c.admin_email === dbUser.email);
  return byEmail[0] || null;
}
