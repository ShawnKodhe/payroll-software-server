import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';

const router = Router();

const KENYA_PAYROLL_CONTEXT = `You are the Comp-rite Kenya AI Assistant, an expert in Kenyan payroll, HR, tax compliance (PAYE, SHIF/NHIF, NSSF, Housing Levy, NITA), share registration, and corporate governance. Be helpful, accurate, and professional. Use markdown formatting.`;

router.post('/llm', authRequired, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: KENYA_PAYROLL_CONTEXT },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1500,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'OpenAI request failed');
      }
      const text = data.choices?.[0]?.message?.content || '';
      return res.json({ result: text });
    } catch (err) {
      console.error('OpenAI error:', err.message);
    }
  }

  const fallback = getLocalFallbackResponse(prompt);
  res.json({ result: fallback });
});

function getLocalFallbackResponse(prompt) {
  const lower = prompt.toLowerCase();
  if (lower.includes('paye')) {
    return `## PAYE in Kenya

PAYE (Pay As You Earn) is income tax deducted monthly from employment income. Employers remit it to KRA by the 9th of the following month.

**Key points:**
- Tax bands are applied on taxable pay after allowable deductions
- Personal relief reduces tax liability
- Insurance relief and pension contributions may reduce taxable income
- Use KRA's iTax portal for filing and payment

Comp-rite calculates PAYE automatically during payroll runs based on current statutory tables configured in **Settings**.`;
  }
  if (lower.includes('nhif') || lower.includes('shif')) {
    return `## SHIF / NHIF

Kenya transitioned to **SHIF (Social Health Insurance Fund)** at **2.75%** of gross monthly pay (with minimum contributions). Legacy NHIF references may still appear on older records.

Comp-rite supports both SHIF and legacy NHIF fields on employee and payroll records.`;
  }
  if (lower.includes('nssf')) {
    return `## NSSF Contributions

NSSF has **Tier I** (lower earnings limit) and **Tier II** (upper band) employee and employer contributions. Rates are set by NSSF and updated periodically.

Comp-rite tracks \`nssf_employee\` and \`nssf_employer\` on each payroll item.`;
  }
  return `## Comp-rite AI Assistant (Local Mode)

I'm running in **local mode** without an OpenAI API key. I can still help with Kenyan payroll concepts.

**Your question:** ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}

To enable full AI responses, set \`OPENAI_API_KEY\` in your server \`.env\` file and restart the API.

**Common topics I can help with:**
- PAYE calculation and KRA compliance
- SHIF, NSSF, Housing Levy, NITA
- Leave entitlements and HR policies
- Using Comp-rite payroll runs and payslips`;
}

export default router;
