const test = require('node:test');
const assert = require('node:assert');
const dbService = require('../db');
const planner = require('../agents/planner');
const leadQualificationAgent = require('../agents/leadQualification');
const crmUpdaterAgent = require('../agents/crmUpdater');
const emailDraftingAgent = require('../agents/emailDrafter');
const supervisorAgent = require('../agents/supervisor');
const orchestrator = require('../agents/orchestrator');

test('EGO Workforce AI Test Suite', async (t) => {
  // Reset and seed database
  dbService.seedLeads(true);

  await t.test('1. DAG Validation & Security Allowlist', () => {
    // Valid DAG
    const validTasks = [
      { id: 'T1', title: 'Fetch', agent: 'Agent A', tool: 'crm_fetch_leads', dependencies: [] },
      { id: 'T2', title: 'Update', agent: 'Agent B', tool: 'crm_update_lead', dependencies: ['T1'] }
    ];
    assert.doesNotThrow(() => planner.validateDAG(validTasks));

    // Security violation: Unauthorized tool
    const illegalToolTasks = [
      { id: 'T1', title: 'Hax', agent: 'Hacker', tool: 'execute_shell_cmd', dependencies: [] }
    ];
    assert.throws(() => planner.validateDAG(illegalToolTasks), /Security Violation/);

    // Cycle detection
    const cyclicTasks = [
      { id: 'T1', title: 'A', agent: 'Agent A', tool: 'crm_fetch_leads', dependencies: ['T2'] },
      { id: 'T2', title: 'B', agent: 'Agent B', tool: 'crm_update_lead', dependencies: ['T1'] }
    ];
    assert.throws(() => planner.validateDAG(cyclicTasks), /Cycle detected/);

    // Missing dependency
    const badDepTasks = [
      { id: 'T1', title: 'A', agent: 'Agent A', tool: 'crm_fetch_leads', dependencies: ['NON_EXISTENT'] }
    ];
    assert.throws(() => planner.validateDAG(badDepTasks), /Invalid dependency reference/);
  });

  await t.test('2. Lead Qualification Deterministic Scoring & Missing Data Flags', async () => {
    // High Enterprise Lead
    const highLead = {
      id: 'TEST-1',
      name: 'Alice CEO',
      company: 'Enterprise Inc',
      email: 'alice@enterprise.com',
      budget_num: 150000,
      purchase_intent: 'Immediate',
      product_interest: 'Autonomous Workflow Orchestration'
    };
    const evalHigh = leadQualificationAgent.evaluateLead(highLead);
    assert.strictEqual(evalHigh.priority, 'High');
    assert.ok(evalHigh.score >= 70, `Score should be >= 70, got ${evalHigh.score}`);
    assert.strictEqual(evalHigh.missingFields.length, 0);

    // Incomplete Lead (missing budget and product interest)
    const incompleteLead = {
      id: 'TEST-2',
      name: 'Bob Mystery',
      company: 'Unknown LLC',
      email: null,
      budget_num: null,
      purchase_intent: null,
      product_interest: null
    };
    const evalIncomplete = leadQualificationAgent.evaluateLead(incompleteLead);
    assert.strictEqual(evalIncomplete.priority, 'Low');
    assert.ok(evalIncomplete.hasMissingData);
    assert.ok(evalIncomplete.missingFields.includes('budget_range'));
    assert.ok(evalIncomplete.missingFields.includes('email'));
  });

  await t.test('3. SafeRun Pre-Execution Preview & Transparent Risk Assessment', async () => {
    const plan = await planner.generatePlan('Process today new leads, update CRM, draft emails, ask me before sending');
    assert.ok(plan.workflow_id);
    assert.ok(plan.preview);
    assert.ok(plan.preview.riskAssessment.score > 0);
    assert.ok(plan.preview.riskAssessment.factors.length > 0);
    assert.ok(plan.preview.summary.estimatedLeadsToProcess > 0);
  });

  await t.test('4. End-to-End Orchestrated Execution with Human Approval Gates', async () => {
    // Reset DB fresh
    dbService.seedLeads(true);

    const plan = await planner.generatePlan('Qualify leads, update CRM, draft personalized emails, ask me before sending.');
    const workflowId = plan.workflow_id;

    dbService.createWorkflow({
      id: workflowId,
      request_prompt: plan.prompt,
      plan_json: plan.tasks,
      preview_json: plan.preview,
      status: 'PLANNED',
      mode: plan.mode
    });

    for (const t of plan.tasks) {
      dbService.createTask(t);
    }

    // Run workflow - should pause at approval gate!
    const step1 = await orchestrator.executeWorkflow(workflowId);
    assert.strictEqual(step1.status, 'PAUSED_APPROVAL', 'Workflow should pause at email approval checkpoint');

    // Verify drafts were created with PENDING_APPROVAL
    const pendingDrafts = dbService.getEmailDrafts(workflowId, 'PENDING_APPROVAL');
    assert.ok(pendingDrafts.length > 0, 'Should have created pending email drafts');

    // Test Human Approval Decision:
    // Approve first draft
    const firstDraft = pendingDrafts[0];
    dbService.updateEmailDraft(firstDraft.id, { status: 'APPROVED', decided_at: new Date().toISOString() });

    // Reject second draft (if available)
    if (pendingDrafts.length > 1) {
      const secondDraft = pendingDrafts[1];
      dbService.updateEmailDraft(secondDraft.id, {
        status: 'REJECTED',
        rejection_reason: 'Budget mismatch identified by human reviewer',
        decided_at: new Date().toISOString()
      });
    }

    // Approve remaining drafts so workflow can finish
    for (let i = 2; i < pendingDrafts.length; i++) {
      dbService.updateEmailDraft(pendingDrafts[i].id, { status: 'APPROVED', decided_at: new Date().toISOString() });
    }

    // Resume workflow
    const step2 = await orchestrator.resumeWorkflow(workflowId);
    assert.strictEqual(step2.status, 'COMPLETED', 'Workflow should complete successfully after approvals');

    // Verify only approved drafts were sent
    const simulatedSends = dbService.getSimulatedEmails(workflowId);
    assert.ok(simulatedSends.length > 0);

    // Verify rejected draft was NOT sent
    if (pendingDrafts.length > 1) {
      const rejectedDraft = pendingDrafts[1];
      const rejectedInSends = simulatedSends.find(s => s.draft_id === rejectedDraft.id);
      assert.strictEqual(rejectedInSends, undefined, 'Rejected draft must NEVER be sent!');
    }

    // Verify EGO SafeRun Execution Proof
    const auditTask = dbService.getTasksByWorkflow(workflowId).find(t => t.tool === 'audit_verify');
    assert.ok(auditTask, 'audit_verify task should exist');
    assert.strictEqual(auditTask.status, 'SUCCEEDED');
    assert.strictEqual(auditTask.output.verification_status, 'PASSED_VERIFIED');
    assert.ok(auditTask.output.verification_hash);
  });

  await t.test('5. Controlled Tool Failure & Automated Bounded Retry', async () => {
    // Enable failure simulation switch
    dbService.setSystemState('simulate_tool_failure', 'true');
    assert.strictEqual(dbService.getSystemState('simulate_tool_failure'), 'true');

    // Create a mini workflow with crm_update_lead
    const failWorkflowId = `WF-FAIL-TEST-${Date.now().toString(36).toUpperCase()}`;
    dbService.createWorkflow({
      id: failWorkflowId,
      request_prompt: 'Test retry resilience on tool failure',
      plan_json: [],
      status: 'PLANNED'
    });

    const crmTask = {
      id: 'T-CRM-FAIL',
      workflow_id: failWorkflowId,
      title: 'Update CRM with Transient Failure',
      agent: 'CRM Updater Agent',
      tool: 'crm_update_lead',
      dependencies: [],
      expected_output: 'Success on retry',
      risk_level: 'MEDIUM',
      requires_approval: false,
      status: 'QUEUED',
      max_retries: 2
    };
    dbService.createTask(crmTask);

    // Setup input evaluations
    const mockContext = {
      evaluations: [
        {
          lead_id: 'LEAD-101',
          score: 85,
          priority: 'High',
          qualificationReason: 'Test score',
          missingFields: []
        }
      ]
    };

    // Execute single task - first attempt will fail with 503, orchestrator will auto-clear toggle and retry
    const result = await orchestrator.executeSingleTask(crmTask, { inputData: mockContext });
    assert.ok(result.success, 'Task should succeed on retry');

    const updatedTask = dbService.getTask('T-CRM-FAIL');
    assert.strictEqual(updatedTask.status, 'SUCCEEDED');
    assert.strictEqual(updatedTask.retries, 1, 'Task should have retried exactly 1 time');
  });
});
