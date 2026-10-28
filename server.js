const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const dbService = require('./db');
const planner = require('./agents/planner');
const orchestrator = require('./agents/orchestrator');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. System Config & Info
app.get('/api/config', (req, res) => {
  const simulatedFailureActive = dbService.getSystemState('simulate_tool_failure', 'false') === 'true';
  res.json({
    name: 'EGO Workforce AI',
    tagline: 'One instruction. Multiple AI employees. Verified results.',
    demo_mode: config.DEMO_MODE,
    model: config.OPENAI_MODEL,
    has_api_key: Boolean(config.OPENAI_API_KEY),
    allowlisted_tools: config.ALLOWLISTED_TOOLS,
    simulated_failure_active: simulatedFailureActive
  });
});

// 2. Dashboard Statistics
app.get('/api/stats', (req, res) => {
  try {
    const stats = dbService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Leads (Simulated CRM)
app.get('/api/leads', (req, res) => {
  try {
    const leads = dbService.getAllLeads();
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Seed / Reset CRM Data (Idempotent)
app.post('/api/leads/seed', (req, res) => {
  try {
    const force = req.body && req.body.force === true;
    const result = dbService.seedLeads(force);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Generate Natural Language Plan & SafeRun Preview
app.post('/api/plan', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Please enter a valid business instruction.' });
    }

    const planResult = await planner.generatePlan(prompt.trim());

    // Persist workflow and tasks in database
    const workflow = dbService.createWorkflow({
      id: planResult.workflow_id,
      request_prompt: prompt.trim(),
      plan_json: planResult.tasks,
      preview_json: planResult.preview,
      status: 'PLANNED',
      mode: planResult.mode
    });

    for (const task of planResult.tasks) {
      dbService.createTask(task);
    }

    res.json({
      workflow_id: planResult.workflow_id,
      mode: planResult.mode,
      model: planResult.model || 'Deterministic Fallback Planner',
      tasks: planResult.tasks,
      preview: planResult.preview
    });
  } catch (err) {
    console.error('Error generating plan:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Execute Workflow
app.post('/api/workflows/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const workflow = dbService.getWorkflow(id);
    if (!workflow) {
      return res.status(404).json({ error: `Workflow ${id} not found.` });
    }

    if (workflow.status === 'RUNNING') {
      return res.status(409).json({ error: `Workflow ${id} is already executing.` });
    }

    // Run orchestrator asynchronously or return immediate progress
    // We execute the workflow loop and return current state
    const executionPromise = orchestrator.executeWorkflow(id);

    // Give it a brief sync window to run initial tasks
    const outcome = await Promise.race([
      executionPromise,
      new Promise(resolve => setTimeout(() => resolve({ status: 'RUNNING', workflow_id: id }), 250))
    ]);

    const updatedWorkflow = dbService.getWorkflow(id);
    const tasks = dbService.getTasksByWorkflow(id);

    res.json({
      workflow: updatedWorkflow,
      tasks,
      outcome
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get Workflow Details, Tasks, and Logs
app.get('/api/workflows/:id', (req, res) => {
  try {
    const { id } = req.params;
    const workflow = dbService.getWorkflow(id);
    if (!workflow) {
      return res.status(404).json({ error: `Workflow ${id} not found.` });
    }

    const tasks = dbService.getTasksByWorkflow(id);
    const drafts = dbService.getEmailDrafts(id);
    const simulatedEmails = dbService.getSimulatedEmails(id);
    const auditLogs = dbService.getAuditLogs(id);

    res.json({
      workflow,
      tasks,
      drafts,
      simulatedEmails,
      auditLogs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Workflow History
app.get('/api/workflows', (req, res) => {
  try {
    const workflows = dbService.getWorkflowHistory();
    res.json(workflows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Get Pending Approvals
app.get('/api/approvals', (req, res) => {
  try {
    const workflowId = req.query.workflow_id || null;
    const drafts = dbService.getEmailDrafts(workflowId, 'PENDING_APPROVAL');
    res.json(drafts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Record Human Approval Decision (Approve / Reject)
app.post('/api/approvals/:id/decide', async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, rejection_reason } = req.body;

    const draft = dbService.getEmailDraftById(id);
    if (!draft) {
      return res.status(404).json({ error: `Draft ${id} not found` });
    }

    if (draft.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ error: `Draft is already decided (status: ${draft.status})` });
    }

    const isApprove = decision === 'approve';
    const newStatus = isApprove ? 'APPROVED' : 'REJECTED';

    dbService.updateEmailDraft(id, {
      status: newStatus,
      rejection_reason: isApprove ? null : (rejection_reason || 'Rejected by user'),
      decided_at: new Date().toISOString()
    });

    dbService.addAuditLog({
      workflow_id: draft.workflow_id,
      task_id: draft.task_id,
      agent: 'Human Reviewer',
      action: isApprove ? 'HUMAN_APPROVAL_GRANTED' : 'HUMAN_APPROVAL_REJECTED',
      entity_type: 'EMAIL_DRAFT',
      entity_id: id,
      before_state: { status: 'PENDING_APPROVAL' },
      after_state: { status: newStatus, rejection_reason },
      details: isApprove
        ? `Human reviewer approved draft for ${draft.recipient}`
        : `Human reviewer rejected draft for ${draft.recipient}: ${rejection_reason || 'Disapproved'}`
    });

    // Check if any drafts are still pending for this workflow
    const remainingPending = dbService.getEmailDrafts(draft.workflow_id, 'PENDING_APPROVAL');

    // If all drafts are now decided, automatically resume the workflow!
    if (remainingPending.length === 0) {
      console.log(`[Server] All pending drafts decided for ${draft.workflow_id}. Resuming orchestrator...`);
      orchestrator.resumeWorkflow(draft.workflow_id).catch(err => {
        console.error('Error auto-resuming workflow:', err);
      });
    }

    res.json({
      success: true,
      draft_id: id,
      new_status: newStatus,
      remaining_pending_count: remainingPending.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Edit Draft Body / Subject before Approval
app.put('/api/approvals/:id/draft', (req, res) => {
  try {
    const { id } = req.params;
    const { subject, body } = req.body;

    const draft = dbService.getEmailDraftById(id);
    if (!draft) {
      return res.status(404).json({ error: `Draft ${id} not found` });
    }

    if (draft.status !== 'PENDING_APPROVAL') {
      return res.status(400).json({ error: 'Cannot edit draft that has already been decided or sent' });
    }

    dbService.updateEmailDraft(id, {
      subject: subject || draft.subject,
      body: body || draft.body
    });

    res.json({ success: true, message: 'Draft updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Simulate Tool Failure Toggle (Feature 9)
app.post('/api/simulate-failure', (req, res) => {
  try {
    const currentState = dbService.getSystemState('simulate_tool_failure', 'false') === 'true';
    const newState = req.body.enabled !== undefined ? Boolean(req.body.enabled) : !currentState;

    dbService.setSystemState('simulate_tool_failure', String(newState));

    res.json({
      simulate_tool_failure: newState,
      message: newState
        ? 'Simulated CRM Tool Failure ENABLED. The next mock CRM operation will encounter a 503 error and trigger automated bounded retry.'
        : 'Simulated Tool Failure DISABLED. Operations will proceed normally.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Audit Trail Logs
app.get('/api/audit-logs', (req, res) => {
  try {
    const logs = dbService.getAuditLogs();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 EGO Workforce AI server running on port ${config.PORT}`);
    console.log(`📍 Web Dashboard: http://localhost:${config.PORT}`);
    console.log(`🛡️ Mode: ${config.DEMO_MODE ? 'Demo / Fallback Mode (Deterministic + Safe)' : 'Hosted LLM Mode'}`);
    console.log(`====================================================`);
  });
}

module.exports = app;
