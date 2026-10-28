const config = require('../config');
const dbService = require('../db');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {}

/**
 * Email Drafting Agent
 * Synthesizes personalized outbound communications using verified CRM data.
 * Saves drafts with PENDING_APPROVAL status.
 */
class EmailDraftingAgent {
  constructor() {
    this.name = 'Email Drafting Agent';
  }

  async generateDraftWithLLM(lead, client) {
    const prompt = `Write a professional, concise executive outreach email for this qualified prospect.
Prospect Details:
Name: ${lead.name}
Company: ${lead.company}
Interest: ${lead.product_interest || 'Enterprise Automation'}
Budget Range: ${lead.budget_range || 'Enterprise scale'}
Timeline: ${lead.purchase_intent || 'Near-term'}

Rules:
- Subject must be compelling and relevant to their industry.
- Tone: Executive, consultative, professional.
- Refer strictly to their stated interest in "${lead.product_interest || 'Enterprise Automation'}".
- Do NOT fabricate fake personal details or false claims.
- Return JSON strictly matching: { "subject": "...", "body": "..." }`;

    try {
      const response = await client.chat.completions.create({
        model: config.OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'You are an executive email personalization specialist. Output valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      return {
        subject: parsed.subject,
        body: parsed.body
      };
    } catch (err) {
      console.warn('[EmailDraftingAgent] LLM email generation failed, falling back to deterministic template:', err.message);
      return this.generateDeterministicDraft(lead);
    }
  }

  generateDeterministicDraft(lead) {
    const firstName = (lead.name || 'Executive').split(' ')[0];
    const interest = lead.product_interest || 'Autonomous Business Automation';
    const company = lead.company || 'your organization';

    const subject = `Accelerating ${interest} at ${company}`;
    const body = `Dear ${firstName},

I noticed your recent inquiry regarding ${interest} for ${company}. Given your targeted ${lead.purchase_intent || 'evaluation'} timeline and operational scope, our autonomous workforce platform is specifically architected to streamline these cross-platform workflows.

We have helped enterprise leaders in your sector deploy multi-agent coordination with guaranteed human-in-the-loop safeguards and audit-verified execution.

Would you be open to a 15-minute briefing this Thursday to review our architectural blueprint tailored for ${company}?

Best regards,

EGO Enterprise Automation Team
EGO Workforce AI`;

    return { subject, body };
  }

  async run(taskContext) {
    const workflowId = taskContext.workflow_id;
    const taskId = taskContext.id;

    // Only draft emails for Qualified leads with High or Medium priority and valid email
    const allLeads = dbService.getAllLeads();
    const candidateLeads = allLeads.filter(l =>
      l.status === 'Qualified' &&
      (l.priority === 'High' || l.priority === 'Medium') &&
      l.email &&
      l.email.trim().length > 0
    );

    let client = null;
    if (config.OPENAI_API_KEY && OpenAI) {
      client = new OpenAI({
        apiKey: config.OPENAI_API_KEY,
        baseURL: config.OPENAI_BASE_URL || undefined
      });
    }

    const draftsCreated = [];

    for (const lead of candidateLeads) {
      const draftId = `DRAFT-${lead.id}-${Date.now().toString(36).toUpperCase()}`;

      let content = null;
      if (client) {
        content = await this.generateDraftWithLLM(lead, client);
      } else {
        content = this.generateDeterministicDraft(lead);
      }

      const draftRecord = {
        id: draftId,
        workflow_id: workflowId,
        task_id: taskId,
        lead_id: lead.id,
        recipient: lead.email,
        recipient_name: lead.name,
        company: lead.company,
        subject: content.subject,
        body: content.body,
        status: 'PENDING_APPROVAL',
        risk_explanation: `High-priority outbound communication addressed to ${lead.name} (${lead.company}). Human sign-off required prior to dispatch.`
      };

      dbService.createEmailDraft(draftRecord);

      dbService.addAuditLog({
        workflow_id: workflowId,
        task_id: taskId,
        agent: this.name,
        action: 'EMAIL_DRAFT_CREATED',
        entity_type: 'EMAIL_DRAFT',
        entity_id: draftId,
        before_state: null,
        after_state: {
          draft_id: draftId,
          recipient: lead.email,
          subject: content.subject,
          status: 'PENDING_APPROVAL'
        },
        details: `Drafted personalized outreach for ${lead.name} at ${lead.company} (Pending Human Approval)`
      });

      draftsCreated.push(draftRecord);
    }

    return {
      agent: this.name,
      drafts_count: draftsCreated.length,
      candidate_leads_evaluated: candidateLeads.length,
      drafts: draftsCreated
    };
  }
}

module.exports = new EmailDraftingAgent();
