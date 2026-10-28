const config = require('../config');
const dbService = require('../db');

// Check OpenAI dependency
let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {}

/**
 * Validate Directed Acyclic Graph (DAG) for tasks
 */
function validateDAG(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('Plan must contain at least one task');
  }

  const taskMap = new Map();
  for (const t of tasks) {
    if (!t.id || !t.title || !t.agent || !t.tool) {
      throw new Error(`Malformed task object: ${JSON.stringify(t)}`);
    }
    if (!config.ALLOWLISTED_TOOLS.includes(t.tool)) {
      throw new Error(`Security Violation: Tool '${t.tool}' is not allowlisted.`);
    }
    taskMap.set(t.id, t);
  }

  // Check dependencies exist and are valid
  for (const t of tasks) {
    const deps = Array.isArray(t.dependencies) ? t.dependencies : [];
    for (const depId of deps) {
      if (!taskMap.has(depId)) {
        throw new Error(`Invalid dependency reference: Task ${t.id} references non-existent task ${depId}`);
      }
      if (depId === t.id) {
        throw new Error(`Self-dependency detected: Task ${t.id} depends on itself`);
      }
    }
  }

  // Cycle detection via DFS
  const visited = new Set();
  const recStack = new Set();

  function hasCycle(taskId) {
    visited.add(taskId);
    recStack.add(taskId);

    const task = taskMap.get(taskId);
    const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
    for (const depId of deps) {
      if (!visited.has(depId)) {
        if (hasCycle(depId)) return true;
      } else if (recStack.has(depId)) {
        return true;
      }
    }

    recStack.delete(taskId);
    return false;
  }

  for (const taskId of taskMap.keys()) {
    if (!visited.has(taskId)) {
      if (hasCycle(taskId)) {
        throw new Error('Cycle detected in task execution graph');
      }
    }
  }

  return true;
}

/**
 * SafeRun Pre-Execution Preview & Risk Evaluation
 */
function generateSafeRunPreview(plan, tasks) {
  const allLeads = dbService.getAllLeads();
  const newLeads = allLeads.filter(l => l.status === 'New');

  // Detect duplicates and incomplete records
  const emailsSeen = new Set();
  const companiesSeen = new Set();
  const duplicates = [];
  const incompleteRecords = [];

  for (const lead of allLeads) {
    const issues = [];
    if (!lead.email) issues.push('Missing email address');
    if (!lead.budget_range && lead.budget_num === null) issues.push('Missing budget information');
    if (!lead.product_interest) issues.push('Missing product interest');

    if (issues.length > 0) {
      incompleteRecords.push({ id: lead.id, name: lead.name, company: lead.company, issues });
    }

    if (lead.email) {
      const normEmail = lead.email.toLowerCase().trim();
      if (emailsSeen.has(normEmail)) {
        duplicates.push({ id: lead.id, name: lead.name, reason: `Duplicate email: ${lead.email}` });
      } else {
        emailsSeen.add(normEmail);
      }
    }

    if (lead.company) {
      const normComp = lead.company.toLowerCase().trim();
      if (companiesSeen.has(normComp)) {
        duplicates.push({ id: lead.id, name: lead.name, reason: `Duplicate company: ${lead.company}` });
      } else {
        companiesSeen.add(normComp);
      }
    }
  }

  // Calculate estimated changes
  const hasLeadFetch = tasks.some(t => t.tool === 'crm_fetch_leads');
  const hasLeadUpdate = tasks.some(t => t.tool === 'crm_update_lead');
  const hasEmailDraft = tasks.some(t => t.tool === 'email_draft');
  const hasEmailSend = tasks.some(t => t.tool === 'email_send_simulated');
  const requiresApproval = tasks.some(t => t.requires_approval);

  const estimatedLeadsToProcess = hasLeadFetch ? newLeads.length : 0;
  // Estimate qualified leads as roughly 70% of new leads
  const estimatedQualifiedLeads = Math.min(estimatedLeadsToProcess, Math.round(estimatedLeadsToProcess * 0.7));
  const estimatedEmailDrafts = hasEmailDraft ? estimatedQualifiedLeads : 0;
  const estimatedSends = hasEmailSend ? estimatedEmailDrafts : 0;

  // Phase B: Transparent Risk Evaluation
  let riskScore = 15; // Base orchestration risk
  const riskFactors = [];

  if (incompleteRecords.length > 0) {
    const penalty = Math.min(25, incompleteRecords.length * 8);
    riskScore += penalty;
    riskFactors.push({
      factor: 'Incomplete Lead Records',
      impact: `+${penalty}`,
      details: `${incompleteRecords.length} records missing critical fields (email, budget, or interest). Safe scoring rules will apply.`
    });
  }

  if (duplicates.length > 0) {
    const penalty = Math.min(20, duplicates.length * 10);
    riskScore += penalty;
    riskFactors.push({
      factor: 'Duplicate Contact Detection',
      impact: `+${penalty}`,
      details: `${duplicates.length} duplicate identities detected in CRM. CRM Updater Agent will deduplicate.`
    });
  }

  if (hasLeadUpdate) {
    riskScore += 15;
    riskFactors.push({
      factor: 'CRM Database Write Operations',
      impact: '+15',
      details: 'Planned mass update on CRM leads status and qualification scores. Audit trail enabled.'
    });
  }

  if (hasEmailSend) {
    riskScore += 25;
    riskFactors.push({
      factor: 'Outbound Communication Dispatch',
      impact: '+25',
      details: 'Workforce plans outbound outreach to external prospect email addresses.'
    });
  }

  if (requiresApproval) {
    riskScore -= 20; // Mitigation
    riskFactors.push({
      factor: 'EGO Human-in-the-Loop Checkpoint',
      impact: '-20 (Mitigation)',
      details: 'Mandatory human approval gate enforced prior to any email transmission.'
    });
  }

  // Bound risk score between 5 and 95
  riskScore = Math.max(5, Math.min(95, riskScore));
  let riskLevel = 'LOW';
  if (riskScore > 65) riskLevel = 'HIGH';
  else if (riskScore > 35) riskLevel = 'MEDIUM';

  return {
    summary: {
      plannedTasksCount: tasks.length,
      estimatedLeadsToProcess,
      estimatedCrmUpdates: hasLeadUpdate ? estimatedLeadsToProcess : 0,
      estimatedEmailDrafts,
      estimatedSimulatedSends: estimatedSends,
      requiresHumanApproval: requiresApproval,
      duplicatesDetected: duplicates.length,
      incompleteRecordsDetected: incompleteRecords.length
    },
    riskAssessment: {
      score: riskScore,
      level: riskLevel,
      explanation: `Calculated based on database state, operation types, and external outreach scope.`,
      factors: riskFactors
    },
    findings: {
      duplicates,
      incompleteRecords
    },
    isEstimate: true
  };
}

/**
 * Deterministic Fallback Planner (for offline or unauthenticated mode)
 */
function generateFallbackPlan(prompt) {
  const normPrompt = prompt.toLowerCase();
  const workflowId = `WF-${Date.now().toString(36).toUpperCase()}`;

  // Analyze intent from natural language
  const wantsLeads = normPrompt.includes('lead') || normPrompt.includes('customer') || normPrompt.includes('prospect');
  const wantsQualify = normPrompt.includes('qualif') || normPrompt.includes('score') || normPrompt.includes('evaluat');
  const wantsCrm = normPrompt.includes('crm') || normPrompt.includes('record') || normPrompt.includes('update');
  const wantsEmail = normPrompt.includes('email') || normPrompt.includes('message') || normPrompt.includes('draft') || normPrompt.includes('reach out');
  const wantsApproval = normPrompt.includes('ask') || normPrompt.includes('approv') || normPrompt.includes('human') || normPrompt.includes('permission') || normPrompt.includes('confirm');

  const tasks = [];
  const t1 = `${workflowId}-TASK-01`;
  const t2 = `${workflowId}-TASK-02`;
  const t3 = `${workflowId}-TASK-03`;
  const t4 = `${workflowId}-TASK-04`;
  const t5 = `${workflowId}-TASK-05`;

  // Task 1: Fetch and qualify leads
  tasks.push({
    id: t1,
    display_id: 'TASK-01',
    workflow_id: workflowId,
    title: 'Query and Qualify Today\'s New Leads',
    agent: 'Lead Qualification Agent',
    tool: 'crm_fetch_leads',
    dependencies: [],
    expected_output: 'Array of evaluated leads with deterministic scoring, priorities (High/Med/Low), and reasoning',
    risk_level: 'LOW',
    requires_approval: false,
    status: 'PLANNED'
  });

  // Task 2: CRM update
  tasks.push({
    id: t2,
    display_id: 'TASK-02',
    workflow_id: workflowId,
    title: 'Persist Qualification Records & Deduplicate CRM',
    agent: 'CRM Updater Agent',
    tool: 'crm_update_lead',
    dependencies: [t1],
    expected_output: 'CRM customer records updated with scores, reasons, before/after audit diffs logged',
    risk_level: 'MEDIUM',
    requires_approval: false,
    status: 'PLANNED'
  });

  // Task 3: Email drafting
  if (wantsEmail || wantsLeads) {
    tasks.push({
      id: t3,
      display_id: 'TASK-03',
      workflow_id: workflowId,
      title: 'Generate Personalized Enterprise Follow-up Drafts',
      agent: 'Email Drafting Agent',
      tool: 'email_draft',
      dependencies: [t2],
      expected_output: 'Custom email drafts tailored to budget, company context, and product interest',
      risk_level: 'MEDIUM',
      requires_approval: false,
      status: 'PLANNED'
    });

    // Task 4: Interactive Send Checkpoint
    tasks.push({
      id: t4,
      display_id: 'TASK-04',
      workflow_id: workflowId,
      title: 'Dispatch Simulated Outbound Emails (Approval Gated)',
      agent: 'Supervisor Agent',
      tool: 'email_send_simulated',
      dependencies: [t3],
      expected_output: 'Execution paused at human checkpoint; approved emails sent to simulated email gateway',
      risk_level: 'HIGH',
      requires_approval: true, // MANDATORY HUMAN CHECKPOINT
      status: 'PLANNED'
    });
  }

  // Task 5: SafeRun Verification & Execution Proof
  const lastTask = tasks[tasks.length - 1];
  tasks.push({
    id: t5,
    display_id: `TASK-0${tasks.length + 1}`,
    workflow_id: workflowId,
    title: 'EGO SafeRun: Post-Execution Independent Verification',
    agent: 'Supervisor Agent',
    tool: 'audit_verify',
    dependencies: [lastTask.id],
    expected_output: 'Cryptographic & state-diff proof comparing intended changes against actual database records',
    risk_level: 'LOW',
    requires_approval: false,
    status: 'PLANNED'
  });

  return {
    workflow_id: workflowId,
    prompt,
    mode: 'DEMO_FALLBACK',
    tasks
  };
}

/**
 * Generate plan using hosted LLM if API key is provided, or transparently fallback
 */
async function generatePlan(prompt) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('Business request prompt cannot be empty');
  }

  let planResult = null;
  let modeUsed = 'DEMO_FALLBACK';

  if (config.OPENAI_API_KEY && OpenAI) {
    try {
      const client = new OpenAI({
        apiKey: config.OPENAI_API_KEY,
        baseURL: config.OPENAI_BASE_URL || undefined
      });
      const systemPrompt = `You are the EGO Workforce AI Planner Agent.
Your job is to convert natural language enterprise business requests into a strict, validated Directed Acyclic Graph (DAG) of tasks executed by 4 specialized agents:
- Lead Qualification Agent (tool: crm_fetch_leads)
- CRM Updater Agent (tool: crm_update_lead)
- Email Drafting Agent (tool: email_draft)
- Supervisor Agent (tools: email_send_simulated, audit_verify)

Allowlisted tools only:
- crm_fetch_leads
- crm_update_lead
- email_draft
- email_send_simulated
- audit_verify

Rules:
1. Every task MUST have id ("TASK-01", "TASK-02", etc.), title, agent, tool, dependencies (array of task ids), expected_output, risk_level ("LOW", "MEDIUM", "HIGH"), requires_approval (boolean).
2. Dependencies must be a valid DAG with NO cycles.
3. If an email send task is included, it MUST require human approval (requires_approval = true) and have risk_level = "HIGH".
4. The final task must always be "audit_verify" by "Supervisor Agent" to provide the EGO SafeRun Execution Proof.
5. Return JSON ONLY matching schema: { "tasks": [...] }`;

      const response = await client.chat.completions.create({
        model: config.OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        validateDAG(parsed.tasks);
        const workflowId = `WF-${Date.now().toString(36).toUpperCase()}`;
        const taskIdMap = new Map();
        parsed.tasks.forEach((t, idx) => {
          const rawId = t.id || `TASK-0${idx + 1}`;
          taskIdMap.set(rawId, `${workflowId}-${rawId}`);
        });

        const normalizedTasks = parsed.tasks.map((t, idx) => {
          const rawId = t.id || `TASK-0${idx + 1}`;
          const newId = taskIdMap.get(rawId) || `${workflowId}-${rawId}`;
          const mappedDeps = (t.dependencies || []).map(d => taskIdMap.get(d) || d);
          return {
            ...t,
            id: newId,
            display_id: rawId,
            workflow_id: workflowId,
            dependencies: mappedDeps,
            status: 'PLANNED'
          };
        });

        planResult = {
          workflow_id: workflowId,
          prompt,
          mode: 'HOSTED_LLM',
          model: config.OPENAI_MODEL,
          tasks: normalizedTasks
        };
        modeUsed = 'HOSTED_LLM';
      }
    } catch (llmErr) {
      console.warn('[PlannerAgent] Hosted LLM call failed or rejected. Falling back to deterministic demo planner:', llmErr.message);
      // Fallback
      planResult = null;
    }
  }

  // If no OpenAI key or LLM failed, fallback safely
  if (!planResult) {
    planResult = generateFallbackPlan(prompt);
    modeUsed = 'DEMO_FALLBACK';
  }

  // Validate the resulting DAG
  validateDAG(planResult.tasks);

  // Generate SafeRun Pre-Execution Preview & Risk Assessment
  const preview = generateSafeRunPreview(planResult, planResult.tasks);
  planResult.preview = preview;
  planResult.mode = modeUsed;

  return planResult;
}

module.exports = {
  generatePlan,
  validateDAG,
  generateSafeRunPreview
};
