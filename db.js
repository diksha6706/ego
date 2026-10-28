const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'ego_workforce.db');
const db = new DatabaseSync(DB_PATH);

// Initialize schema
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT,
      budget_range TEXT,
      budget_num REAL,
      product_interest TEXT,
      purchase_intent TEXT,
      lead_source TEXT,
      status TEXT DEFAULT 'New',
      qualification_score INTEGER,
      priority TEXT DEFAULT 'Unassigned',
      qualification_reason TEXT,
      missing_fields TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      request_prompt TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      preview_json TEXT,
      status TEXT DEFAULT 'PLANNED',
      mode TEXT DEFAULT 'DEMO',
      created_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      title TEXT NOT NULL,
      agent TEXT NOT NULL,
      tool TEXT NOT NULL,
      dependencies TEXT,
      expected_output TEXT,
      risk_level TEXT DEFAULT 'LOW',
      requires_approval INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PLANNED',
      retries INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 2,
      output_json TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS email_drafts (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      task_id TEXT,
      lead_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      recipient_name TEXT,
      company TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING_APPROVAL',
      risk_explanation TEXT,
      rejection_reason TEXT,
      created_at TEXT,
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS simulated_emails (
      message_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      draft_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      approval_status TEXT NOT NULL,
      simulated_delivery_status TEXT DEFAULT 'SIMULATED_DELIVERED',
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT,
      task_id TEXT,
      agent TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_state TEXT,
      after_state TEXT,
      details TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// 20 Fictional Enterprise Leads
const FICTIONAL_LEADS = [
  {
    id: 'LEAD-101',
    name: 'Alexander Vance',
    company: 'Apex Logistics Global',
    email: 'a.vance@apexlogistics.com',
    budget_range: '$100k - $250k',
    budget_num: 175000,
    product_interest: 'Autonomous Multi-Agent Supply Chain Orchestration',
    purchase_intent: 'Immediate',
    lead_source: 'Enterprise Demo Request',
    status: 'New'
  },
  {
    id: 'LEAD-102',
    name: 'Dr. Elena Rostova',
    company: 'BioSyn Health Analytics',
    email: 'elena.rostova@biosynhealth.io',
    budget_range: '$80k - $120k',
    budget_num: 95000,
    product_interest: 'Cross-Platform Patient Data Workflow Automation',
    purchase_intent: '1-3 Months',
    lead_source: 'Inbound Web',
    status: 'New'
  },
  {
    id: 'LEAD-103',
    name: 'Marcus Sterling',
    company: 'Sterling & Croft Capital',
    email: 'marcus@sterlingcroft.com',
    budget_range: '$150k - $300k',
    budget_num: 220000,
    product_interest: 'FinTech Compliance Verification & Audit Agents',
    purchase_intent: 'Immediate',
    lead_source: 'Executive Referral',
    status: 'New'
  },
  {
    id: 'LEAD-104',
    name: 'Sophia Chen',
    company: 'NovaCloud Technologies',
    email: 'sophia.chen@novacloud.tech',
    budget_range: '$50k - $80k',
    budget_num: 65000,
    product_interest: 'DevOps Incident Resolution Orchestration',
    purchase_intent: '1-3 Months',
    lead_source: 'Webinar Attendee',
    status: 'New'
  },
  {
    id: 'LEAD-105',
    name: 'Tariq Al-Mansoor',
    company: 'OmniRetail Commerce',
    email: 'tariq.m@omniretail.ae',
    budget_range: '$90k - $140k',
    budget_num: 110000,
    product_interest: 'Omnichannel Inventory Agent Sync',
    purchase_intent: 'Immediate',
    lead_source: 'Outbound Campaign',
    status: 'New'
  },
  {
    id: 'LEAD-106',
    name: 'Rachel Gallagher',
    company: 'Veritas Cyber Defense',
    email: 'rachel@veritascyber.com',
    budget_range: '$100k+',
    budget_num: 130000,
    product_interest: 'Autonomous Threat Triage & Dispatch',
    purchase_intent: '1-3 Months',
    lead_source: 'Enterprise Demo Request',
    status: 'New'
  },
  {
    id: 'LEAD-107',
    name: 'David K. Hoffman',
    company: 'Strata Energy Systems',
    email: 'dhoffman@strataenergy.com',
    budget_range: '$40k - $70k',
    budget_num: 55000,
    product_interest: 'Grid Sensor Maintenance Routing Agents',
    purchase_intent: 'Exploring',
    lead_source: 'Industry Conference',
    status: 'New'
  },
  {
    id: 'LEAD-108',
    name: 'Kavita Patel',
    company: 'Aura Fintech Solutions',
    email: 'kavita.p@aurafintech.co',
    budget_range: '$75k - $125k',
    budget_num: 90000,
    product_interest: 'Automated Loan Underwriting Escalations',
    purchase_intent: 'Immediate',
    lead_source: 'Inbound Web',
    status: 'New'
  },
  {
    id: 'LEAD-109',
    name: 'Liam O’Connor',
    company: 'Dublin Data Foundry',
    email: 'liam@dublindata.ie',
    budget_range: '$20k - $40k',
    budget_num: 30000,
    product_interest: 'Data Pipeline Error Remediation Agents',
    purchase_intent: 'Exploring',
    lead_source: 'Community Forum',
    status: 'New'
  },
  {
    id: 'LEAD-110',
    name: 'Camila Rodriguez',
    company: 'Solaria Solar Dynamics',
    email: 'camila.r@solariadynamics.org',
    budget_range: '$35k - $50k',
    budget_num: 42000,
    product_interest: 'Customer Support Escalation & Follow-ups',
    purchase_intent: '1-3 Months',
    lead_source: 'Partner Referral',
    status: 'New'
  },
  {
    id: 'LEAD-111',
    name: 'Hans Becker',
    company: 'Kaiser Precision Tooling',
    email: 'h.becker@kaiserprecision.de',
    budget_range: '$60k - $90k',
    budget_num: 75000,
    product_interest: 'ERP & SAP Autonomous Task Dispatch',
    purchase_intent: 'Exploring',
    lead_source: 'Industrial Trade Show',
    status: 'New'
  },
  {
    id: 'LEAD-112',
    name: 'Zoe Washington',
    company: 'UrbanPulse Media Group',
    email: 'zoe@urbanpulsemedia.io',
    budget_range: '$25k - $45k',
    budget_num: 35000,
    product_interest: 'Ad Campaign Workflow Tracking',
    purchase_intent: 'Exploring',
    lead_source: 'Social Ad',
    status: 'New'
  },
  {
    id: 'LEAD-113',
    name: 'Lucas Wright',
    company: 'Wright Handyman Services',
    email: 'lucas@wrighthandyman.local',
    budget_range: '<$5k',
    budget_num: 2500,
    product_interest: 'General AI Assistant',
    purchase_intent: 'Exploring',
    lead_source: 'Organic Search',
    status: 'New'
  },
  {
    id: 'LEAD-114',
    name: 'Arthur Pendelton',
    company: 'Self-Employed Freelance Dev',
    email: 'arthur.p@gmail.com',
    budget_range: '$500',
    budget_num: 500,
    product_interest: 'Free tier exploration',
    purchase_intent: 'None',
    lead_source: 'Blog Post',
    status: 'New'
  },
  // Incomplete record: Missing Budget and missing phone/notes
  {
    id: 'LEAD-115',
    name: 'Jordan Miller',
    company: 'Apex Logistics Global', // Duplicate company name intentionally!
    email: 'jordan.m@apexlogistics.com',
    budget_range: null,
    budget_num: null,
    product_interest: 'Fleet Automation Agents',
    purchase_intent: 'Immediate',
    lead_source: 'Enterprise Demo Request',
    status: 'New'
  },
  // Incomplete record: Missing Email
  {
    id: 'LEAD-116',
    name: 'Unknown Contact',
    company: 'Quantum Matrix Systems',
    email: null,
    budget_range: '$90k - $150k',
    budget_num: 120000,
    product_interest: 'High Frequency Algorithmic Monitoring',
    purchase_intent: 'Immediate',
    lead_source: 'Inbound Web',
    status: 'New'
  },
  // Incomplete record: Missing Product Interest
  {
    id: 'LEAD-117',
    name: 'Beatrice Holt',
    company: 'Holt Agricultural Logistics',
    email: 'beatrice@holtlogistics.com',
    budget_range: '$40k - $60k',
    budget_num: 50000,
    product_interest: null,
    purchase_intent: 'Exploring',
    lead_source: 'Cold Email Reply',
    status: 'New'
  },
  // Duplicate-like record: Duplicate email as LEAD-101
  {
    id: 'LEAD-118',
    name: 'Alex Vance (Secondary)',
    company: 'Apex Logistics North America',
    email: 'a.vance@apexlogistics.com', // Duplicate email
    budget_range: '$100k - $250k',
    budget_num: 175000,
    product_interest: 'Cross-Platform Enterprise Dispatch',
    purchase_intent: 'Immediate',
    lead_source: 'Outbound',
    status: 'New'
  },
  {
    id: 'LEAD-119',
    name: 'Priya Sharma',
    company: 'Zenith BioPharma Labs',
    email: 'p.sharma@zenithbiopharma.org',
    budget_range: '$110k - $180k',
    budget_num: 140000,
    product_interest: 'Clinical Trial Patient Follow-up Agents',
    purchase_intent: 'Immediate',
    lead_source: 'Enterprise Demo Request',
    status: 'New'
  },
  {
    id: 'LEAD-120',
    name: 'Kenji Takahashi',
    company: 'NeoTokyo Robotics Inc.',
    email: 'k.takahashi@neotokyo-robotics.jp',
    budget_range: '$95k - $160k',
    budget_num: 125000,
    product_interest: 'Industrial IoT Telemetry Workflow Router',
    purchase_intent: '1-3 Months',
    lead_source: 'Executive Referral',
    status: 'New'
  }
];

// Seed fictional leads idempotently
function seedLeads(force = false) {
  initSchema();
  const countRow = db.prepare('SELECT COUNT(*) as count FROM leads').get();
  if (countRow.count > 0 && !force) {
    return { count: countRow.count, message: 'Leads already seeded' };
  }

  // Clear existing leads and dependent records if force
  if (force) {
    db.exec('DELETE FROM leads');
    db.exec('DELETE FROM email_drafts');
    db.exec('DELETE FROM simulated_emails');
    db.exec('DELETE FROM audit_logs');
    db.exec('DELETE FROM tasks');
    db.exec('DELETE FROM workflows');
  }

  const now = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO leads (
      id, name, company, email, budget_range, budget_num, product_interest,
      purchase_intent, lead_source, status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  for (const lead of FICTIONAL_LEADS) {
    insertStmt.run(
      lead.id,
      lead.name,
      lead.company,
      lead.email,
      lead.budget_range,
      lead.budget_num,
      lead.product_interest,
      lead.purchase_intent,
      lead.lead_source,
      lead.status,
      now,
      now
    );
  }

  return { count: FICTIONAL_LEADS.length, message: `Successfully seeded ${FICTIONAL_LEADS.length} leads` };
}

// Database helper functions
const dbService = {
  db,
  initSchema,
  seedLeads,

  // Leads
  getAllLeads() {
    return db.prepare('SELECT * FROM leads ORDER BY id ASC').all();
  },

  getLeadsByStatus(status) {
    return db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY id ASC').all(status);
  },

  getLeadById(id) {
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  },

  updateLead(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const query = `UPDATE leads SET ${fields.join(', ')} WHERE id = ?`;
    return db.prepare(query).run(...values);
  },

  // Workflows
  createWorkflow(workflow) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO workflows (id, request_prompt, plan_json, preview_json, status, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflow.id,
      workflow.request_prompt,
      typeof workflow.plan_json === 'string' ? workflow.plan_json : JSON.stringify(workflow.plan_json),
      workflow.preview_json ? (typeof workflow.preview_json === 'string' ? workflow.preview_json : JSON.stringify(workflow.preview_json)) : null,
      workflow.status || 'PLANNED',
      workflow.mode || 'DEMO',
      now
    );
    return this.getWorkflow(workflow.id);
  },

  getWorkflow(id) {
    const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!wf) return null;
    try { wf.plan = JSON.parse(wf.plan_json); } catch (_) { wf.plan = []; }
    try { wf.preview = wf.preview_json ? JSON.parse(wf.preview_json) : null; } catch (_) { wf.preview = null; }
    return wf;
  },

  updateWorkflow(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
    }
    values.push(id);
    const query = `UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`;
    return db.prepare(query).run(...values);
  },

  getWorkflowHistory() {
    const rows = db.prepare('SELECT * FROM workflows ORDER BY created_at DESC LIMIT 50').all();
    return rows.map(r => {
      try { r.plan = JSON.parse(r.plan_json); } catch (_) { r.plan = []; }
      try { r.preview = r.preview_json ? JSON.parse(r.preview_json) : null; } catch (_) { r.preview = null; }
      return r;
    });
  },

  // Tasks
  createTask(task) {
    db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id, workflow_id, title, agent, tool, dependencies, expected_output,
        risk_level, requires_approval, status, max_retries, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.workflow_id,
      task.title,
      task.agent,
      task.tool,
      Array.isArray(task.dependencies) ? JSON.stringify(task.dependencies) : (task.dependencies || '[]'),
      task.expected_output || '',
      task.risk_level || 'LOW',
      task.requires_approval ? 1 : 0,
      task.status || 'PLANNED',
      task.max_retries || 2,
      task.started_at || null
    );
  },

  getTasksByWorkflow(workflowId) {
    const rows = db.prepare('SELECT * FROM tasks WHERE workflow_id = ? ORDER BY id ASC').all(workflowId);
    return rows.map(r => {
      try { r.dependencies = JSON.parse(r.dependencies); } catch (_) { r.dependencies = []; }
      try { r.output = r.output_json ? JSON.parse(r.output_json) : null; } catch (_) { r.output = null; }
      return r;
    });
  },

  getTask(id) {
    const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!r) return null;
    try { r.dependencies = JSON.parse(r.dependencies); } catch (_) { r.dependencies = []; }
    try { r.output = r.output_json ? JSON.parse(r.output_json) : null; } catch (_) { r.output = null; }
    return r;
  },

  updateTask(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
    }
    values.push(id);
    return db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  // Email Drafts
  createEmailDraft(draft) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO email_drafts (
        id, workflow_id, task_id, lead_id, recipient, recipient_name,
        company, subject, body, status, risk_explanation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draft.id,
      draft.workflow_id,
      draft.task_id || null,
      draft.lead_id,
      draft.recipient,
      draft.recipient_name || '',
      draft.company || '',
      draft.subject,
      draft.body,
      draft.status || 'PENDING_APPROVAL',
      draft.risk_explanation || null,
      now
    );
  },

  getEmailDrafts(workflowId = null, status = null) {
    let query = 'SELECT * FROM email_drafts WHERE 1=1';
    const params = [];
    if (workflowId) {
      query += ' AND workflow_id = ?';
      params.push(workflowId);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    return db.prepare(query).all(...params);
  },

  getEmailDraftById(id) {
    return db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(id);
  },

  updateEmailDraft(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    values.push(id);
    return db.prepare(`UPDATE email_drafts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },

  // Simulated Emails
  createSimulatedEmail(email) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO simulated_emails (
        message_id, workflow_id, draft_id, lead_id, recipient, subject,
        body, approval_status, simulated_delivery_status, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      email.message_id,
      email.workflow_id,
      email.draft_id,
      email.lead_id,
      email.recipient,
      email.subject,
      email.body,
      email.approval_status,
      'SIMULATED_DELIVERED',
      now
    );
  },

  getSimulatedEmails(workflowId = null) {
    if (workflowId) {
      return db.prepare('SELECT * FROM simulated_emails WHERE workflow_id = ? ORDER BY sent_at DESC').all(workflowId);
    }
    return db.prepare('SELECT * FROM simulated_emails ORDER BY sent_at DESC').all();
  },

  // Audit Logs
  addAuditLog(entry) {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO audit_logs (
        workflow_id, task_id, agent, action, entity_type, entity_id,
        before_state, after_state, details, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.workflow_id || null,
      entry.task_id || null,
      entry.agent || 'SYSTEM',
      entry.action,
      entry.entity_type,
      entry.entity_id,
      typeof entry.before_state === 'object' && entry.before_state !== null ? JSON.stringify(entry.before_state) : (entry.before_state || null),
      typeof entry.after_state === 'object' && entry.after_state !== null ? JSON.stringify(entry.after_state) : (entry.after_state || null),
      entry.details || null,
      now
    );
  },

  getAuditLogs(workflowId = null) {
    if (workflowId) {
      return db.prepare('SELECT * FROM audit_logs WHERE workflow_id = ? ORDER BY id ASC').all(workflowId);
    }
    return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
  },

  // System State (e.g. failure simulation)
  getSystemState(key, defaultValue = null) {
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  },

  setSystemState(key, value) {
    return db.prepare(`
      INSERT INTO system_state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  },

  // Dashboard Stats
  getDashboardStats() {
    const leadsTotal = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
    const leadsQualified = db.prepare("SELECT COUNT(*) as c FROM leads WHERE status IN ('Qualified', 'Follow-up Sent')").get().c;
    const workflowsTotal = db.prepare('SELECT COUNT(*) as c FROM workflows').get().c;
    const draftsPending = db.prepare("SELECT COUNT(*) as c FROM email_drafts WHERE status = 'PENDING_APPROVAL'").get().c;
    const emailsSimulated = db.prepare('SELECT COUNT(*) as c FROM simulated_emails').get().c;
    const simulatedFailureActive = this.getSystemState('simulate_tool_failure', 'false') === 'true';

    return {
      leadsTotal,
      leadsQualified,
      workflowsTotal,
      draftsPending,
      emailsSimulated,
      simulatedFailureActive
    };
  }
};

// Initialize schema on load
dbService.initSchema();
dbService.seedLeads(false);

module.exports = dbService;
