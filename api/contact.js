const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
}

function calcPrice(diameter) {
  return Math.max(100, Math.round(diameter * 3));
}

function validate(body) {
  const errors = [];
  const fullName = stripHtml(String(body.fullName || ''));
  const email    = String(body.email || '').trim().toLowerCase();
  const phone    = String(body.phone || '').trim();
  const diameter = parseFloat(body.diameter);
  const notes    = stripHtml(String(body.notes || ''));

  if (!fullName || fullName.length < 2)                       errors.push('Full name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))   errors.push('Valid email is required.');
  if (!phone || phone.replace(/\D/g, '').length < 10)         errors.push('Valid phone number is required.');
  if (isNaN(diameter) || diameter <= 0 || diameter > 500)     errors.push('Please enter a valid stump diameter (1–500 inches).');
  if (notes.length > 2000)                                    errors.push('Notes are too long.');

  if (errors.length) return { valid: false, errors };
  return { valid: true, data: { fullName, email, phone, diameter, notes } };
}

async function generateEmailBody(lead, price) {
  const firstName = lead.fullName.split(' ')[0];

  const prompt = [
    'You are writing a follow-up email on behalf of Milwaukee Projects, a professional stump grinding and removal company serving the Milwaukee, Wisconsin area.',
    '',
    'A customer just submitted a quote request. Their details are:',
    `- First name: ${firstName}`,
    `- Stump diameter: ${lead.diameter} inches`,
    `- Estimated price: $${price} (we charge $3 per inch with a $100 minimum)`,
    lead.notes ? `- Additional notes they left: ${lead.notes}` : '- Additional notes: none provided',
    '',
    'Write a warm, friendly, and professional follow-up email body that:',
    '1. Opens by addressing them by their first name',
    '2. Thanks them genuinely for reaching out to Milwaukee Projects',
    `3. Acknowledges their stump (reference the ${lead.diameter}-inch diameter) and clearly states the estimated price of $${price}`,
    '4. Notes that the final quote will be confirmed after a quick on-site look, and that someone will be in touch within 24 hours to schedule',
    '5. Invites them to call or reply if they have immediate questions',
    '6. Closes warmly from "The Milwaukee Projects Team"',
    '',
    'Tone: conversational, confident, and human — like a real pro who does this every day wrote it, not a corporate auto-reply.',
    'Length: 3–4 short paragraphs.',
    'Return the email body text only — no subject line, no extra commentary.',
  ].join('\n');

  const response = await anthropic.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const result = validate(req.body);
  if (!result.valid) {
    return res.status(400).json({ success: false, errors: result.errors });
  }

  const lead  = result.data;
  const price = calcPrice(lead.diameter);
  const firstName = lead.fullName.split(' ')[0];

  try {
    const emailBody = await generateEmailBody(lead, price);

    await resend.emails.send({
      from:    'Milwaukee Projects <hello@milwaukeeprojects.com>',
      to:      lead.email,
      subject: `Your stump removal quote — Milwaukee Projects`,
      text:    emailBody,
    });

    await resend.emails.send({
      from:    'Milwaukee Projects <hello@milwaukeeprojects.com>',
      to:      process.env.OWNER_EMAIL,
      subject: `New quote: ${lead.fullName} — ${lead.diameter}" stump (~$${price})`,
      text: [
        'New stump removal quote request:',
        '',
        `Name:       ${lead.fullName}`,
        `Email:      ${lead.email}`,
        `Phone:      ${lead.phone}`,
        `Diameter:   ${lead.diameter} inches`,
        `Est. Price: $${price}`,
        `Notes:      ${lead.notes || 'None'}`,
      ].join('\n'),
    });

    return res.status(200).json({ success: true, message: 'Received.' });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ success: false, error: 'Something went wrong.' });
  }
};
