import { jsPDF } from 'jspdf';
import { db, parseEntityRow } from '../db.js';

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fillRect(doc, x, y, w, h, r, g, b) {
  doc.setFillColor(r, g, b);
  doc.rect(x, y, w, h, 'F');
}

function hLine(doc, x, y, w, r = 220, g = 220, b = 220) {
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + w, y);
}

function tableRow(doc, x, y, desc, amount, isDeduction, shade) {
  if (shade) fillRect(doc, x - 2, y - 4.5, 86, 7, 248, 249, 252);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(50, 50, 50);
  doc.text(desc, x + 2, y);
  doc.setTextColor(isDeduction ? 180 : 30, isDeduction ? 50 : 30, isDeduction ? 50 : 30);
  doc.text(fmt(amount), x + 84, y, { align: 'right' });
}

function getEntity(type, filter) {
  const rows = db.prepare('SELECT * FROM entities WHERE entity_type = ?').all(type);
  const records = rows.map(parseEntityRow);
  return records.find((r) =>
    Object.entries(filter).every(([k, v]) => r[k] === v)
  );
}

export function generatePayslipPdf({ payroll_item_id, payroll_run_id }) {
  const item = getEntity('PayrollItem', { id: payroll_item_id });
  if (!item) throw new Error('PayrollItem not found');

  let run = null;
  const runId = payroll_run_id || item.payroll_run_id;
  if (runId) run = getEntity('PayrollRun', { id: runId });

  let employee = null;
  if (item.employee_id) employee = getEntity('Employee', { id: item.employee_id });

  const componentRows = db.prepare(
    "SELECT * FROM entities WHERE entity_type = 'PayrollComponent'"
  ).all();
  const allComponents = componentRows
    .map(parseEntityRow)
    .filter((c) => c.status === 'active');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210;
  const margin = 15;
  const colW = (PW - margin * 2 - 6) / 2;

  fillRect(doc, 0, 0, PW, 38, 18, 42, 88);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('COMP-RITE', margin, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(170, 190, 230);
  doc.text('KENYA LIMITED', margin, 21);
  doc.setFontSize(7.5);
  doc.text('Share Registration  •  Payroll Solutions  •  Corporate Software', margin, 27);
  doc.text('Westlands Business Park, Nairobi, Kenya  |  info@comp-rite.co.ke', margin, 32);

  fillRect(doc, 148, 6, 47, 26, 59, 130, 246);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('PAYSLIP', 171.5, 16, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(run?.period_label || '', 171.5, 24, { align: 'center' });

  fillRect(doc, 0, 38, PW, 30, 245, 247, 252);
  hLine(doc, 0, 38, PW, 200, 210, 230);

  const empName =
    item.employee_name ||
    `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim() ||
    'Employee';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(18, 42, 88);
  doc.text(empName, margin, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(90, 100, 120);
  doc.text(employee?.job_title || '', margin, 56);
  doc.text(employee?.department ? `Department: ${employee.department}` : '', margin, 61);

  const infoX = PW - margin;
  doc.setFontSize(8);
  if (employee?.employee_id) doc.text(`Employee No: ${employee.employee_id}`, infoX, 46, { align: 'right' });
  if (employee?.kra_pin) doc.text(`KRA PIN: ${employee.kra_pin}`, infoX, 52, { align: 'right' });
  if (employee?.nhif_number) doc.text(`NHIF No: ${employee.nhif_number}`, infoX, 58, { align: 'right' });
  if (employee?.nssf_number) doc.text(`NSSF No: ${employee.nssf_number}`, infoX, 64, { align: 'right' });

  const genDate = new Date().toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  doc.setFontSize(7.5);
  doc.setTextColor(140, 150, 165);
  doc.text(`Generated: ${genDate}`, infoX, 68, { align: 'right' });
  hLine(doc, 0, 68, PW, 200, 210, 230);

  const tableTop = 74;
  const leftX = margin;
  const rightX = margin + colW + 6;
  fillRect(doc, leftX - 2, tableTop, colW + 2, 8, 18, 42, 88);
  fillRect(doc, rightX - 2, tableTop, colW + 2, 8, 18, 42, 88);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('EARNINGS', leftX + 2, tableTop + 5.5);
  doc.text('DEDUCTIONS', rightX + 2, tableTop + 5.5);

  const earnings = [
    { label: 'Basic Salary', val: item.basic_salary },
    { label: 'House Allowance', val: item.house_allowance },
    { label: 'Transport Allowance', val: item.transport_allowance },
    { label: "Director's Fee", val: item.directors_fee },
    { label: 'Leave Pay', val: item.leave_pay },
    { label: 'Overtime Pay', val: item.overtime_pay },
    { label: 'Acting Allowance', val: item.acting_allowance },
    { label: 'Commuter Allowance', val: item.commuter_allowance },
    { label: 'Airtime Allowance', val: item.airtime_allowance },
    { label: 'Medical Allowance', val: item.medical_allowance },
    { label: 'Car Benefit', val: item.car_benefit },
    { label: 'Bonus / Commission', val: item.bonus },
    { label: 'Gratuity', val: item.gratuity },
    { label: 'Other Allowances', val: item.other_allowances },
    ...allComponents
      .filter((c) => c.category === 'earning' || c.category === 'benefit')
      .map((c) => ({ label: c.name, val: item[`custom_${c.id}`] })),
  ].filter((e) => e.val && e.val > 0);

  const deductions = [
    { label: 'PAYE Tax', val: item.paye },
    { label: 'SHIF (2.75%)', val: item.shif },
    { label: 'NHIF', val: !item.shif && item.nhif ? item.nhif : null },
    { label: 'NSSF (Employee)', val: item.nssf_employee },
    { label: 'Housing Levy (1.5%)', val: item.housing_levy_employee },
    { label: 'NITA Levy', val: item.nita },
    { label: 'Pension (Employee)', val: item.pension_employee },
    { label: 'Loan Repayment', val: item.loan_deduction },
    { label: 'SACCO Savings/Shares', val: item.sacco_deduction },
    { label: 'HELB Repayment', val: item.helb_deduction },
    { label: 'Staff Welfare', val: item.welfare_deduction },
    { label: 'Union Dues', val: item.union_dues },
    { label: 'Salary Advance Recovery', val: item.advance_deduction },
    { label: 'Other Deductions', val: item.other_deductions },
    ...allComponents
      .filter((c) => c.category === 'deduction')
      .map((c) => ({ label: c.name, val: item[`custom_${c.id}`] })),
  ].filter((d) => d.val && d.val > 0);

  const maxRows = Math.max(earnings.length, deductions.length, 1);
  const rowH = maxRows > 14 ? 6 : 7.5;
  let curY = tableTop + 10;

  for (let i = 0; i < maxRows; i++) {
    const shade = i % 2 === 0;
    if (earnings[i]) tableRow(doc, leftX, curY, earnings[i].label, earnings[i].val, false, shade);
    if (deductions[i]) tableRow(doc, rightX, curY, deductions[i].label, deductions[i].val, true, shade);
    curY += rowH;
  }

  const totalsY = curY + 3;
  fillRect(doc, leftX - 2, totalsY - 4.5, colW + 2, 8, 230, 245, 255);
  fillRect(doc, rightX - 2, totalsY - 4.5, colW + 2, 8, 255, 235, 235);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(18, 42, 88);
  doc.text('GROSS EARNINGS', leftX + 2, totalsY);
  doc.text(`KES ${fmt(item.gross_pay)}`, leftX + 84, totalsY, { align: 'right' });
  doc.setTextColor(160, 30, 30);
  doc.text('TOTAL DEDUCTIONS', rightX + 2, totalsY);
  doc.text(`KES ${fmt(item.total_deductions)}`, rightX + 84, totalsY, { align: 'right' });

  const netY = totalsY + 14;
  fillRect(doc, margin, netY - 7, PW - margin * 2, 18, 18, 42, 88);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(160, 195, 255);
  doc.text('NET PAY (Take Home)', margin + 6, netY + 1);
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(`KES ${fmt(item.net_pay)}`, PW - margin - 6, netY + 2, { align: 'right' });

  const pdfBytes = doc.output('arraybuffer');
  const base64 = Buffer.from(pdfBytes).toString('base64');
  const filename = `Payslip_${(item.employee_name || 'Employee').replace(/\s+/g, '_')}_${run?.period || 'period'}.pdf`;

  return { pdf_base64: base64, filename };
}
