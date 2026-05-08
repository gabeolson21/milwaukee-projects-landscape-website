const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
}

function validate(body) {
  const errors = [];
  const fullName = stripHtml(String(body.fullName || ''));
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const service = String(body.service || '').trim();
  const message = stripHtml(String(body.message || ''));

  if (!fullName || fullName.length < 2) errors.push('Full name is required.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email is required.');
  if (!phone || phone.replace(/\D/g, '').length < 10) errors.push('Valid phone number is required.');
  if (!['Lawn Mowing', 'Leaf Removal'].includes(service)) errors.push('Valid service is required.');
  if (message.length > 2000) errors.push('Message is too long.');

  if (errors.length) return { valid: false, errors };
  return { valid: true, data: { fullName, email, phone, service, message } };
}

async function generateEmailBody(lead) {
  const firstName = lead.fullName.split(' ')[0];

  const prompt = [
    'You are writing a follow-up email on behalf of Milwaukee Projects, a professional lawn care and landscaping company serving the Milwaukee, Wisconsin area.',
    '',
    'A customer just submitted a contact form. Their details are:',
    `- First name: ${firstName}`,
    `- Service they are interested in: ${lead.service}`,
    lead.message ? `- Additional notes they left: ${lead.message}` : '- Additional notes: none provided',
    '',
    'Write a warm, friendly, and professional follow-up email body that:',
    '1. Opens by addressing them by their first name',
    '2. Thanks them genuinely for reaching out to Milwaukee Projects',
    '3. Acknowledges the specific service they are interested in',
    '4. Confirms their request has been received and that someone will follow up within 24–48 hours',
    '5. Invites them to call or reply if they have immediate questions',
    '6. Closes with a warm sign-off from "The Milwaukee Projects Team"',
    '',
    'Tone: conversational, human, and welcoming — like a real person wrote it, not a corporate auto-reply.',
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

  const lead = result.data;
  const firstName = lead.fullName.split(' ')[0];

  try {
    const emailBody = await generateEmailBody(lead);

    await resend.emails.send({
      from: 'Milwaukee Projects <hello@milwaukeeprojects.com>',
      to: lead.email,
      subject: `Thanks for contacting Milwaukee Projects, ${firstName}!`,
      text: emailBody,
    });

    await resend.emails.send({
      from: 'Milwaukee Projects <hello@milwaukeeprojects.com>',
      to: process.env.OWNER_EMAIL,
      subject: `New lead: ${lead.fullName} — ${lead.service}`,
      text: [
        'New contact form submission:',
        '',
        `Name:    ${lead.fullName}`,
        `Email:   ${lead.email}`,
        `Phone:   ${lead.phone}`,
        `Service: ${lead.service}`,
        `Message: ${lead.message || 'None'}`,
      ].join('\n'),
    });

    return res.status(200).json({ success: true, message: 'Received.' });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ success: false, error: 'Something went wrong.' });
  }
};
