const dbService = require('../db');

/**
 * CRM Updater Agent
 * Applies qualification scores to CRM records using allowlisted database operations.
 * Deduplicates contacts, logs before/after diffs in the audit trail, and respects failure simulation.
 */
class CrmUpdaterAgent {
  constructor() {
    this.name = 'CRM Updater Agent';
  }

  async run(taskContext) {
    const workflowId = taskContext.workflow_id;
    const taskId = taskContext.id;
    let evaluations = (taskContext.inputData && taskContext.inputData.evaluations) || taskContext.evaluations;

    // Check for simulated tool failure trigger (Feature 9)
    const failureTriggered = dbService.getSystemState('simulate_tool_failure', 'false') === 'true';
    if (failureTriggered) {
      console.warn('[CrmUpdaterAgent] Controlled tool failure injected for resilience testing!');
      throw new Error('[CRM_CONNECTION_TIMEOUT] 503 Transient Database Cluster Timeout: Connection to CRM replica failed.');
    }

    if (!Array.isArray(evaluations)) {
      const leadQualificationAgent = require('./leadQualification');
      const qualResult = await leadQualificationAgent.run(taskContext);
      evaluations = qualResult.evaluations;
    }

    const seenEmails = new Set();
    const seenCompanies = new Set();
    let updatedCount = 0;
    let duplicateSkipped = 0;
    const diffs = [];

    for (const evalResult of evaluations) {
      const leadId = evalResult.lead_id;
      const beforeState = dbService.getLeadById(leadId);
      if (!beforeState) continue;

      // Duplicate check
      let isDuplicate = false;
      let duplicateReason = '';

      if (beforeState.email) {
        const normEmail = beforeState.email.toLowerCase().trim();
        if (seenEmails.has(normEmail)) {
          isDuplicate = true;
          duplicateReason = `Duplicate email already processed: ${beforeState.email}`;
        } else {
          seenEmails.add(normEmail);
        }
      }

      if (beforeState.company) {
        const normCompany = beforeState.company.toLowerCase().trim();
        if (seenCompanies.has(normCompany)) {
          // If secondary contact in same company
          duplicateReason = `Secondary contact from existing account: ${beforeState.company}`;
        } else {
          seenCompanies.add(normCompany);
        }
      }

      if (isDuplicate) {
        duplicateSkipped++;
        dbService.addAuditLog({
          workflow_id: workflowId,
          task_id: taskId,
          agent: this.name,
          action: 'CRM_DEDUPLICATION_FLAGGED',
          entity_type: 'LEAD',
          entity_id: leadId,
          before_state: { status: beforeState.status },
          after_state: { status: 'Duplicate - Merged', flag: duplicateReason },
          details: `Skipped duplicate CRM write for ${beforeState.name} (${duplicateReason})`
        });
        continue;
      }

      // Determine updated status
      let newStatus = 'Qualified';
      if (evalResult.priority === 'Low') {
        newStatus = 'Unqualified';
      }

      const updates = {
        status: newStatus,
        qualification_score: evalResult.score,
        priority: evalResult.priority,
        qualification_reason: evalResult.qualificationReason,
        missing_fields: JSON.stringify(evalResult.missingFields)
      };

      dbService.updateLead(leadId, updates);
      const afterState = dbService.getLeadById(leadId);

      // Record before/after audit log
      dbService.addAuditLog({
        workflow_id: workflowId,
        task_id: taskId,
        agent: this.name,
        action: 'CRM_RECORD_UPDATED',
        entity_type: 'LEAD',
        entity_id: leadId,
        before_state: {
          status: beforeState.status,
          score: beforeState.qualification_score,
          priority: beforeState.priority
        },
        after_state: {
          status: afterState.status,
          score: afterState.qualification_score,
          priority: afterState.priority
        },
        details: `Updated ${beforeState.name} @ ${beforeState.company} to ${afterState.priority} priority (Score: ${afterState.qualification_score})`
      });

      diffs.push({
        lead_id: leadId,
        name: beforeState.name,
        company: beforeState.company,
        score: evalResult.score,
        priority: evalResult.priority,
        status_change: `${beforeState.status} -> ${afterState.status}`
      });

      updatedCount++;
    }

    return {
      agent: this.name,
      updated_count: updatedCount,
      duplicate_skipped: duplicateSkipped,
      diffs
    };
  }
}

module.exports = new CrmUpdaterAgent();
