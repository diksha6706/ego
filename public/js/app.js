/**
 * EGO Workforce AI — Client-Side Application Logic
 * Implements real-time DAG task visualization, SafeRun preview & verification,
 * interactive human approval checkpoint, and failure resilience testing.
 */

const state = {
  activeWorkflowId: null,
  activeWorkflow: null,
  tasks: [],
  pollInterval: null,
  config: null
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initEventListeners();
  loadConfig();
  refreshStats();
  loadLeads();
  loadApprovals();
  loadHistory();
});

// ==========================================================================
// Navigation
// ==========================================================================

function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      if (targetId === 'tab-leads') loadLeads();
      if (targetId === 'tab-approvals') loadApprovals();
      if (targetId === 'tab-history') loadHistory();
    });
  });
}

function switchTab(tabId) {
  const btn = document.getElementById(`tabBtn-${tabId.replace('tab-', '')}`);
  if (btn) btn.click();
}

// ==========================================================================
// Event Listeners
// ==========================================================================

function initEventListeners() {
  // Preset prompt pills
  document.querySelectorAll('.preset-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.getElementById('promptInput').value = pill.getAttribute('data-preset');
    });
  });

  // Generate Plan button
  document.getElementById('generatePlanBtn').addEventListener('click', handleGeneratePlan);

  // Approve & Execute Plan button
  document.getElementById('approveAndExecutePlanBtn').addEventListener('click', handleExecuteWorkflow);

  // Simulate Tool Failure toggle
  document.getElementById('simFailureToggle').addEventListener('change', async (e) => {
    try {
      const res = await fetch('/api/simulate-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: e.target.checked })
      });
      const data = await res.json();
      console.log('Simulated failure toggled:', data);
    } catch (err) {
      console.error('Error toggling failure:', err);
    }
  });

  // Reset Demo CRM button
  document.getElementById('reseedDataBtn').addEventListener('click', async () => {
    if (!confirm('Reset all CRM leads, workflow runs, drafts, and simulated emails?')) return;
    try {
      const res = await fetch('/api/leads/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      const data = await res.json();
      alert(data.message || 'Demo CRM reset successfully');
      refreshStats();
      loadLeads();
      loadApprovals();
      loadHistory();
      document.getElementById('safeRunPreviewSection').style.display = 'none';
      document.getElementById('safeRunProofSection').style.display = 'none';
      state.activeWorkflowId = null;
      renderDagNodes([]);
    } catch (err) {
      alert('Error resetting data: ' + err.message);
    }
  });
}

// ==========================================================================
// API Calls & Data Loaders
// ==========================================================================

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    state.config = cfg;

    const modelBadge = document.getElementById('plannerModelBadge');
    const modelText = document.getElementById('plannerModelText');
    const simToggle = document.getElementById('simFailureToggle');

    simToggle.checked = Boolean(cfg.simulated_failure_active);

    if (cfg.has_api_key && !cfg.demo_mode) {
      modelBadge.classList.remove('demo-mode');
      modelText.textContent = `Hosted LLM: ${cfg.model}`;
    } else {
      modelBadge.classList.add('demo-mode');
      modelText.textContent = `Deterministic Fallback Planner (Demo Mode)`;
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

async function refreshStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    document.getElementById('statLeadsTotal').textContent = stats.leadsTotal;
    document.getElementById('statLeadsQualified').textContent = stats.leadsQualified;
    document.getElementById('statWorkflowsTotal').textContent = stats.workflowsTotal;
    document.getElementById('statDraftsPending').textContent = stats.draftsPending;
    document.getElementById('statEmailsSimulated').textContent = stats.emailsSimulated;

    const navBadge = document.getElementById('navApprovalBadge');
    if (stats.draftsPending > 0) {
      navBadge.textContent = stats.draftsPending;
      navBadge.style.display = 'inline-block';
    } else {
      navBadge.style.display = 'none';
    }
  } catch (err) {
    console.error('Error refreshing stats:', err);
  }
}

async function loadLeads() {
  try {
    const res = await fetch('/api/leads');
    const leads = await res.json();
    const tbody = document.getElementById('leadsTableBody');
    tbody.innerHTML = '';

    leads.forEach(lead => {
      const tr = document.createElement('tr');
      const scoreText = lead.qualification_score !== null ? `${lead.qualification_score}/100` : '—';
      const budgetText = lead.budget_range || '<span style="color:var(--status-danger)">Missing Budget</span>';
      const emailText = lead.email || '<span style="color:var(--status-danger)">Missing Email</span>';

      tr.innerHTML = `
        <td><code style="font-family:var(--font-mono);font-size:11px;">${lead.id}</code></td>
        <td>
          <strong>${escapeHtml(lead.name)}</strong><br>
          <span style="font-size:11px;color:var(--text-muted);">${emailText}</span>
        </td>
        <td>${escapeHtml(lead.company)}</td>
        <td>${budgetText}</td>
        <td>${escapeHtml(lead.purchase_intent || '—')}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(lead.product_interest || '')}">
          ${escapeHtml(lead.product_interest || '—')}
        </td>
        <td><strong>${scoreText}</strong></td>
        <td><span class="priority-badge priority-${lead.priority || 'Unassigned'}">${lead.priority || 'Unassigned'}</span></td>
        <td><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(lead.status)}</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading leads:', err);
  }
}

async function loadApprovals() {
  try {
    const res = await fetch('/api/approvals');
    const drafts = await res.json();
    const container = document.getElementById('approvalListContainer');

    if (!drafts || drafts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
          <p style="margin-top: 10px;">No pending actions requiring approval at this time.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    drafts.forEach(draft => {
      const card = document.createElement('div');
      card.className = 'approval-card';
      card.id = `approval-card-${draft.id}`;

      card.innerHTML = `
        <div class="approval-header">
          <div class="approval-title-group">
            <h4>Outbound Email Dispatch — ${escapeHtml(draft.company)}</h4>
            <p>Recipient: <strong>${escapeHtml(draft.recipient_name || draft.recipient)}</strong> (${escapeHtml(draft.recipient)}) &bull; Lead Ref: <code>${draft.lead_id}</code></p>
          </div>
          <span class="risk-level-badge high">HUMAN APPROVAL REQUIRED</span>
        </div>

        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;padding:8px 12px;font-size:12px;color:#fbbf24;">
          🛡️ <strong>SafeRun Checkpoint:</strong> ${escapeHtml(draft.risk_explanation || 'External email outreach. Requires human authorization.')}
        </div>

        <div class="approval-body-editor">
          <div class="editor-field-group">
            <label>Subject Line</label>
            <input type="text" class="editor-input" id="subject-${draft.id}" value="${escapeHtml(draft.subject)}">
          </div>
          <div class="editor-field-group">
            <label>Message Body (Editable)</label>
            <textarea class="editor-textarea" id="body-${draft.id}">${escapeHtml(draft.body)}</textarea>
          </div>
        </div>

        <div class="approval-actions-row">
          <button class="btn-secondary-sm" onclick="saveDraftEdits('${draft.id}')">
            Save Edits
          </button>
          <button class="btn-reject" onclick="decideApproval('${draft.id}', 'reject')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Reject Outreach
          </button>
          <button class="btn-approve" onclick="decideApproval('${draft.id}', 'approve')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>
            Approve & Dispatch Simulated Send
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading approvals:', err);
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/workflows');
    const workflows = await res.json();
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';

    if (!workflows || workflows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No workflows recorded yet.</td></tr>`;
      return;
    }

    workflows.forEach(wf => {
      const tr = document.createElement('tr');
      const taskCount = wf.plan ? wf.plan.length : 0;
      const durationSec = (wf.duration_ms / 1000).toFixed(1);
      const timeStr = new Date(wf.created_at).toLocaleTimeString();

      tr.innerHTML = `
        <td><code style="font-family:var(--font-mono);font-size:11px;">${wf.id}</code></td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(wf.request_prompt)}">
          ${escapeHtml(wf.request_prompt)}
        </td>
        <td><span class="task-status-pill status-${wf.status}">${wf.status}</span></td>
        <td>${taskCount} tasks</td>
        <td>${durationSec}s</td>
        <td>${timeStr}</td>
        <td>
          <button class="btn-secondary-sm" onclick="viewWorkflowDetails('${wf.id}')">View Details</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

// ==========================================================================
// Planner & SafeRun Pre-Execution Preview
// ==========================================================================

async function handleGeneratePlan() {
  const promptInput = document.getElementById('promptInput');
  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert('Please enter a business instruction.');
    return;
  }

  const btn = document.getElementById('generatePlanBtn');
  btn.disabled = true;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
    Synthesizing Plan...
  `;

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate plan');

    state.activeWorkflowId = data.workflow_id;
    state.tasks = data.tasks;

    // Render SafeRun Preview
    renderSafeRunPreview(data.preview);

    // Render DAG Task nodes in IDLE/PLANNED state
    renderDagNodes(data.tasks);

    // Update active workflow labels
    document.getElementById('activeWorkflowIdLabel').textContent = `Workflow ID: ${data.workflow_id}`;
    document.getElementById('activeWorkflowStatusPill').className = 'task-status-pill status-PLANNED';
    document.getElementById('activeWorkflowStatusPill').textContent = 'PLANNED';

    // Hide proof section until execution completes
    document.getElementById('safeRunProofSection').style.display = 'none';

    refreshStats();
  } catch (err) {
    alert('Error generating plan: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
      Generate Plan
    `;
  }
}

function renderSafeRunPreview(preview) {
  if (!preview) return;

  const section = document.getElementById('safeRunPreviewSection');
  section.style.display = 'flex';

  const sum = preview.summary || {};
  document.getElementById('prevPlannedTasks').textContent = sum.plannedTasksCount || 0;
  document.getElementById('prevLeads').textContent = sum.estimatedLeadsToProcess || 0;
  document.getElementById('prevCrmUpdates').textContent = sum.estimatedCrmUpdates || 0;
  document.getElementById('prevDrafts').textContent = sum.estimatedEmailDrafts || 0;
  document.getElementById('prevDuplicates').textContent = sum.duplicatesDetected || 0;
  document.getElementById('prevIncomplete').textContent = sum.incompleteRecordsDetected || 0;

  // Risk Assessment
  const risk = preview.riskAssessment || {};
  const score = risk.score || 20;
  const level = risk.level || 'LOW';

  const scoreEl = document.getElementById('prevRiskScore');
  scoreEl.textContent = score;

  const badgeEl = document.getElementById('prevRiskBadge');
  badgeEl.className = `risk-level-badge ${level.toLowerCase()}`;
  badgeEl.textContent = `${level} RISK`;

  const barEl = document.getElementById('prevRiskBar');
  barEl.style.width = `${score}%`;
  if (level === 'HIGH') barEl.style.background = 'var(--status-danger)';
  else if (level === 'MEDIUM') barEl.style.background = 'var(--status-warning)';
  else barEl.style.background = 'var(--status-success)';

  // Risk Factors list
  const factorsList = document.getElementById('prevRiskFactorsList');
  factorsList.innerHTML = '';
  (risk.factors || []).forEach(f => {
    const item = document.createElement('div');
    item.className = 'risk-factor-item';
    const isMitigation = f.impact.includes('Mitigation') || f.impact.startsWith('-');
    item.innerHTML = `
      <span><strong>${escapeHtml(f.factor)}:</strong> ${escapeHtml(f.details)}</span>
      <span class="risk-factor-impact ${isMitigation ? 'impact-neg' : 'impact-pos'}">${escapeHtml(f.impact)}</span>
    `;
    factorsList.appendChild(item);
  });

  // Findings
  const findingsContainer = document.getElementById('findingsAlertContainer');
  findingsContainer.innerHTML = '';
  if (preview.findings) {
    if (preview.findings.duplicates && preview.findings.duplicates.length > 0) {
      const dup = document.createElement('div');
      dup.style.cssText = 'background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;padding:6px 10px;font-size:11px;color:#fbbf24;margin-bottom:6px;';
      dup.innerHTML = `⚠️ <strong>Duplicate Warning:</strong> ${preview.findings.duplicates.length} duplicate entries detected. CRM Updater Agent will prevent duplicate CRM records.`;
      findingsContainer.appendChild(dup);
    }
    if (preview.findings.incompleteRecords && preview.findings.incompleteRecords.length > 0) {
      const inc = document.createElement('div');
      inc.style.cssText = 'background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.25);border-radius:6px;padding:6px 10px;font-size:11px;color:#f87171;';
      inc.innerHTML = `⚠️ <strong>Incomplete Records Warning:</strong> ${preview.findings.incompleteRecords.length} records missing required fields. Safe evaluation rules will penalize missing data without guessing.`;
      findingsContainer.appendChild(inc);
    }
  }

  // Scroll to preview smoothly
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==========================================================================
// Workflow Execution & Real-Time Orchestration Polling
// ==========================================================================

async function handleExecuteWorkflow() {
  if (!state.activeWorkflowId) {
    alert('Please generate a plan first.');
    return;
  }

  const btn = document.getElementById('approveAndExecutePlanBtn');
  btn.disabled = true;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
    Executing Autonomous Workforce...
  `;

  try {
    const res = await fetch(`/api/workflows/${state.activeWorkflowId}/execute`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Execution failed to start');

    // Start live polling loop
    startWorkflowPolling(state.activeWorkflowId);
  } catch (err) {
    alert('Error executing workflow: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      Approve Plan & Execute Workforce
    `;
  }
}

function startWorkflowPolling(workflowId) {
  if (state.pollInterval) clearInterval(state.pollInterval);

  state.pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/workflows/${workflowId}`);
      if (!res.ok) return;

      const data = await res.json();
      state.activeWorkflow = data.workflow;
      state.tasks = data.tasks;

      // Update Active Status
      const statusPill = document.getElementById('activeWorkflowStatusPill');
      statusPill.className = `task-status-pill status-${data.workflow.status}`;
      statusPill.textContent = data.workflow.status;

      // Re-render Task DAG with updated statuses & logs
      renderDagNodes(data.tasks);

      // Refresh approval center and stats
      refreshStats();
      loadApprovals();

      // Check for Paused on Human Approval
      if (data.workflow.status === 'PAUSED_APPROVAL') {
        const btn = document.getElementById('approveAndExecutePlanBtn');
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Paused: Human Approval Required in Approval Center
        `;
      }

      // Check for Completion or Failure
      if (data.workflow.status === 'COMPLETED' || data.workflow.status === 'FAILED') {
        clearInterval(state.pollInterval);
        state.pollInterval = null;

        const btn = document.getElementById('approveAndExecutePlanBtn');
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Workflow ${data.workflow.status}
        `;

        // If completed, fetch and render EGO SafeRun Execution Proof
        if (data.workflow.status === 'COMPLETED') {
          renderSafeRunProof(data);
          loadLeads();
          loadHistory();
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 750);
}

// ==========================================================================
// Task DAG Visualization
// ==========================================================================

function renderDagNodes(tasks) {
  const container = document.getElementById('dagNodesContainer');
  const runsContainer = document.getElementById('runsDagContainer');

  if (!tasks || tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        <p style="margin-top: 10px;">Enter an instruction above and click <strong>Generate Plan</strong> to visualize the multi-agent task graph.</p>
      </div>
    `;
    if (runsContainer) runsContainer.innerHTML = container.innerHTML;
    return;
  }

  const html = tasks.map((t, idx) => {
    const statusClass = t.status.toLowerCase().replace('_', '-');
    const isApproval = t.requires_approval ? '<span class="risk-level-badge medium" style="font-size:10px;">HUMAN CHECKPOINT</span>' : '';
    const depsText = t.dependencies && t.dependencies.length > 0 ? t.dependencies.join(', ') : 'None (Root Node)';
    const retriesBadge = t.retries > 0 ? `<span class="model-tag demo-mode" style="font-size:10px;">Retries: ${t.retries}/${t.max_retries}</span>` : '';
    const durationText = t.duration_ms ? `${(t.duration_ms / 1000).toFixed(2)}s` : '—';

    let outputPreview = '';
    if (t.output) {
      outputPreview = `
        <div style="margin-top:6px;">
          <span style="font-size:10px;text-transform:uppercase;color:var(--text-dim);font-weight:600;">Execution Output:</span>
          <pre class="node-output-drawer">${escapeHtml(JSON.stringify(t.output, null, 2))}</pre>
        </div>
      `;
    } else if (t.error_message) {
      outputPreview = `
        <div style="margin-top:6px;">
          <span style="font-size:10px;text-transform:uppercase;color:var(--status-danger);font-weight:600;">Transient Error / Retry:</span>
          <pre class="node-output-drawer" style="color:#f87171;border-color:rgba(244,63,94,0.3);">${escapeHtml(t.error_message)}</pre>
        </div>
      `;
    }

    return `
      <div class="dag-node ${statusClass}" id="dag-node-${t.id}">
        <div class="dag-node-header">
          <div class="node-title-group">
            <span class="node-step-badge">${t.display_id || (t.id.includes('-TASK-') ? 'TASK-' + t.id.split('-TASK-')[1] : t.id)}</span>
            <span class="node-title">${escapeHtml(t.title)}</span>
            ${isApproval}
            ${retriesBadge}
          </div>
          <span class="task-status-pill status-${t.status}">
            ${t.status === 'RUNNING' ? '<span class="pulse-dot"></span>' : ''}
            ${t.status}
          </span>
        </div>

        <div class="dag-node-details">
          <div class="node-meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            Assigned: <strong>${escapeHtml(t.agent)}</strong>
          </div>
          <div class="node-meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            Tool: <code style="font-family:var(--font-mono);font-size:11px;color:var(--accent-cyan);">${escapeHtml(t.tool)}</code>
          </div>
          <div class="node-meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Duration: <strong>${durationText}</strong>
          </div>
          <div class="node-meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            Depends On: <code>${escapeHtml(depsText)}</code>
          </div>
        </div>

        ${outputPreview}
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  if (runsContainer) runsContainer.innerHTML = html;
}

// ==========================================================================
// EGO SafeRun Execution Proof (Post-Execution Verification)
// ==========================================================================

function renderSafeRunProof(workflowData) {
  const section = document.getElementById('safeRunProofSection');
  section.style.display = 'flex';

  const auditTask = (workflowData.tasks || []).find(t => t.tool === 'audit_verify');
  const proof = (auditTask && auditTask.output) ? auditTask.output : null;

  if (!proof) {
    console.warn('No audit proof found in workflow results');
    return;
  }

  const badgeEl = document.getElementById('proofStatusBadge');
  badgeEl.textContent = proof.verification_status;
  if (proof.verification_status === 'PASSED_VERIFIED') {
    badgeEl.style.background = 'rgba(16, 185, 129, 0.15)';
    badgeEl.style.color = '#34d399';
    badgeEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  } else {
    badgeEl.style.background = 'rgba(244, 63, 94, 0.15)';
    badgeEl.style.color = '#f43f5e';
    badgeEl.style.borderColor = 'rgba(244, 63, 94, 0.4)';
  }

  document.getElementById('proofHashVal').textContent = proof.verification_hash;

  // Proof Metrics
  const metrics = proof.metrics || {};
  const metricsGrid = document.getElementById('proofMetricsGrid');
  metricsGrid.innerHTML = `
    <div class="proof-metric-box">
      <div class="proof-metric-val" style="color:#34d399;">${metrics.completed_tasks} / ${metrics.planned_tasks}</div>
      <div class="proof-metric-lbl">Tasks Verified</div>
    </div>
    <div class="proof-metric-box">
      <div class="proof-metric-val" style="color:#38bdf8;">${metrics.crm_records_updated}</div>
      <div class="proof-metric-lbl">CRM Records Updated</div>
    </div>
    <div class="proof-metric-box">
      <div class="proof-metric-val" style="color:#fbbf24;">${metrics.crm_duplicates_safeguarded}</div>
      <div class="proof-metric-lbl">Duplicates Deduplicated</div>
    </div>
    <div class="proof-metric-box">
      <div class="proof-metric-val" style="color:#c084fc;">${metrics.email_drafts_generated}</div>
      <div class="proof-metric-lbl">Drafts Created</div>
    </div>
    <div class="proof-metric-box">
      <div class="proof-metric-val" style="color:#34d399;">${metrics.human_approvals_approved}</div>
      <div class="proof-metric-lbl">Human Approvals</div>
    </div>
    <div class="proof-metric-box">
      <div class="proof-metric-val" style="color:#38bdf8;">${metrics.simulated_emails_sent}</div>
      <div class="proof-metric-lbl">Simulated Sends</div>
    </div>
  `;

  // Sample Diffs Drawer
  const diffsDrawer = document.getElementById('proofDiffsDrawer');
  diffsDrawer.textContent = JSON.stringify({
    verification_passed: proof.verification_status === 'PASSED_VERIFIED',
    discrepancies_detected: proof.discrepancies || [],
    audit_events_persisted: proof.audit_events_count,
    state_diff_samples: proof.sample_diffs
  }, null, 2);

  // Scroll to proof smoothly
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==========================================================================
// Approval Center Actions (Approve / Reject / Edit)
// ==========================================================================

async function decideApproval(draftId, decision) {
  let rejectionReason = null;
  if (decision === 'reject') {
    rejectionReason = prompt('Optional: Enter rejection reason for audit log:', 'Budget or prospect timing mismatch');
    if (rejectionReason === null) return; // User cancelled prompt
  }

  try {
    const res = await fetch(`/api/approvals/${draftId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, rejection_reason: rejectionReason })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to record decision');

    // Remove draft card from UI
    const card = document.getElementById(`approval-card-${draftId}`);
    if (card) {
      card.style.opacity = '0.5';
      card.style.pointerEvents = 'none';
      setTimeout(() => card.remove(), 300);
    }

    refreshStats();
    loadApprovals();

    // If active workflow was paused, resume polling
    if (state.activeWorkflowId) {
      startWorkflowPolling(state.activeWorkflowId);
    }
  } catch (err) {
    alert('Error recording decision: ' + err.message);
  }
}

async function saveDraftEdits(draftId) {
  const subject = document.getElementById(`subject-${draftId}`).value;
  const body = document.getElementById(`body-${draftId}`).value;

  try {
    const res = await fetch(`/api/approvals/${draftId}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save edits');
    alert('Draft updated successfully.');
  } catch (err) {
    alert('Error saving edits: ' + err.message);
  }
}

// View Workflow from history
async function viewWorkflowDetails(workflowId) {
  try {
    const res = await fetch(`/api/workflows/${workflowId}`);
    const data = await res.json();

    state.activeWorkflowId = workflowId;
    state.activeWorkflow = data.workflow;
    state.tasks = data.tasks;

    switchTab('tab-overview');

    if (data.workflow.preview) {
      renderSafeRunPreview(data.workflow.preview);
    }

    renderDagNodes(data.tasks);

    if (data.workflow.status === 'COMPLETED') {
      renderSafeRunProof(data);
    }

    document.getElementById('activeWorkflowIdLabel').textContent = `Workflow ID: ${workflowId}`;
    document.getElementById('activeWorkflowStatusPill').className = `task-status-pill status-${data.workflow.status}`;
    document.getElementById('activeWorkflowStatusPill').textContent = data.workflow.status;
  } catch (err) {
    alert('Error loading workflow details: ' + err.message);
  }
}

// Utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
