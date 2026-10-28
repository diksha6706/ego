const crypto = require('crypto');
const dbService = require('../db');

/**
 * Supervisor Agent
 * Coordinates task compliance, enforces approval gates, prevents unauthorized actions,
 * and generates the cryptographic EGO SafeRun Execution Proof based on actual stored results.
 */
class SupervisorAgent {
  constructor() {
    this.name = 'Supervisor Agent';
  }

  /**
   * Dispatches approved email drafts to the simulated email service.
   * STRICT ENFORCEMENT: Never sends unapproved or rejected drafts!
   */
  async executeSimulatedEmailSend(taskContext) {
    const workflowId = taskContext.workflow_id;
    const taskId = taskContext.id;

    // Fetch all drafts for this workflow
    const drafts = dbService.getEmailDrafts(workflowId);

    const pendingDrafts = drafts.filter(d => d.status === 'PENDING_APPROVAL');
    const approvedDrafts = drafts.filter(d => d.status === 'APPROVED');
    const rejectedDrafts = drafts.filter(d => d.status === 'REJECTED');

    // If there are still pending drafts awaiting human review, signal approval gate
    if (pendingDrafts.length > 0) {
      return {
        status: 'AWAITING_APPROVAL',
        message: `${pendingDrafts.length} email draft(s) require human authorization before dispatch.`,
        pending_count: pendingDrafts.length,
        approved_count: approvedDrafts.length,
        rejected_count: rejectedDrafts.length
      };
    }

    let sentCount = 0;
    const sentResults = [];

    // Process only APPROVED drafts
    for (const draft of approvedDrafts) {
      // Check idempotency: has this draft already been simulated as sent?
      const existingSends = dbService.getSimulatedEmails(workflowId).filter(s => s.draft_id === draft.id);
      if (existingSends.length > 0) {
        // Already sent
        continue;
      }

      const messageId = `MSG-SIM-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

      // Insert simulated email record
      dbService.createSimulatedEmail({
        message_id: messageId,
        workflow_id: workflowId,
        draft_id: draft.id,
        lead_id: draft.lead_id,
        recipient: draft.recipient,
        subject: draft.subject,
        body: draft.body,
        approval_status: 'APPROVED'
      });

      // Update draft status to SENT
      dbService.updateEmailDraft(draft.id, {
        status: 'SENT'
      });

      // Update lead status
      dbService.updateLead(draft.lead_id, {
        status: 'Follow-up Sent'
      });

      // Log in audit trail
      dbService.addAuditLog({
        workflow_id: workflowId,
        task_id: taskId,
        agent: this.name,
        action: 'EMAIL_SIMULATED_SEND',
        entity_type: 'SIMULATED_EMAIL',
        entity_id: messageId,
        before_state: { draft_id: draft.id, status: 'APPROVED' },
        after_state: { message_id: messageId, delivery_status: 'SIMULATED_DELIVERED' },
        details: `Simulated transmission completed for ${draft.recipient}. (SIMULATED EMAIL ONLY - No external network dispatch)`
      });

      sentResults.push({
        message_id: messageId,
        recipient: draft.recipient,
        subject: draft.subject,
        simulated_status: 'SIMULATED_DELIVERED'
      });

      sentCount++;
    }

    // Log rejected drafts if any
    for (const rejected of rejectedDrafts) {
      dbService.addAuditLog({
        workflow_id: workflowId,
        task_id: taskId,
        agent: this.name,
        action: 'EMAIL_DISPATCH_PREVENTED',
        entity_type: 'EMAIL_DRAFT',
        entity_id: rejected.id,
        before_state: { status: 'REJECTED' },
        after_state: { status: 'CANCELLED_BY_HUMAN' },
        details: `Outbound send halted by human reviewer for ${rejected.recipient}. Rejection reason: ${rejected.rejection_reason || 'Disapproved'}`
      });
    }

    return {
      status: 'SUCCEEDED',
      agent: this.name,
      sent_count: sentCount,
      rejected_count: rejectedDrafts.length,
      sent_messages: sentResults,
      disclaimer: 'SIMULATED EMAIL: All messages persisted in local simulated gateway. No real emails transmitted.'
    };
  }

  /**
   * SafeRun: Post-Execution Independent Verification (Execution Proof)
   * Queries stored database state and generates verifiable proof comparing intended vs actual changes.
   */
  async runAuditVerification(taskContext) {
    const workflowId = taskContext.workflow_id;
    const workflow = dbService.getWorkflow(workflowId);
    const tasks = dbService.getTasksByWorkflow(workflowId);
    const auditLogs = dbService.getAuditLogs(workflowId);
    const drafts = dbService.getEmailDrafts(workflowId);
    const simulatedEmails = dbService.getSimulatedEmails(workflowId);
    const allLeads = dbService.getAllLeads();

    // Actual metrics from database
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'SUCCEEDED').length;
    const failedTasks = tasks.filter(t => t.status === 'FAILED').length;
    const retriedTasks = tasks.filter(t => t.retries > 0).length;

    const crmUpdates = auditLogs.filter(a => a.action === 'CRM_RECORD_UPDATED');
    const deduplications = auditLogs.filter(a => a.action === 'CRM_DEDUPLICATION_FLAGGED');
    const draftsCreated = drafts.length;
    const approvedDrafts = drafts.filter(d => d.status === 'APPROVED' || d.status === 'SENT').length;
    const rejectedDrafts = drafts.filter(d => d.status === 'REJECTED').length;
    const pendingDrafts = drafts.filter(d => d.status === 'PENDING_APPROVAL').length;
    const simulatedSends = simulatedEmails.length;

    // Check consistency
    const discrepancies = [];

    // Check that simulated sends strictly match approved count
    if (simulatedSends > approvedDrafts) {
      discrepancies.push(`Security Alert: Simulated sends (${simulatedSends}) exceeded approved drafts (${approvedDrafts})!`);
    }

    // Check if any rejected email was sent
    const rejectedDraftIds = new Set(drafts.filter(d => d.status === 'REJECTED').map(d => d.id));
    for (const sim of simulatedEmails) {
      if (rejectedDraftIds.has(sim.draft_id)) {
        discrepancies.push(`Critical Violation: Rejected draft ${sim.draft_id} was simulated as sent!`);
      }
    }

    const verificationPassed = discrepancies.length === 0;

    // Generate cryptographic verification fingerprint
    const proofPayload = {
      workflowId,
      timestamp: new Date().toISOString(),
      tasksCompleted: completedTasks,
      crmUpdatesCount: crmUpdates.length,
      draftsCreated,
      simulatedSends,
      passed: verificationPassed
    };

    const proofHash = crypto.createHash('sha256').update(JSON.stringify(proofPayload)).digest('hex');

    const proofReport = {
      title: 'EGO SafeRun: Execution Proof',
      workflow_id: workflowId,
      verification_status: verificationPassed ? 'PASSED_VERIFIED' : 'FAILED_VERIFICATION',
      verification_hash: `0x${proofHash.substring(0, 16)}...${proofHash.substring(48)}`,
      timestamp: new Date().toISOString(),
      discrepancies,
      metrics: {
        planned_tasks: totalTasks,
        completed_tasks: completedTasks,
        failed_tasks: failedTasks,
        retried_tasks: retriedTasks,
        crm_records_updated: crmUpdates.length,
        crm_duplicates_safeguarded: deduplications.length,
        email_drafts_generated: draftsCreated,
        human_approvals_approved: approvedDrafts,
        human_approvals_rejected: rejectedDrafts,
        human_approvals_pending: pendingDrafts,
        simulated_emails_sent: simulatedSends
      },
      audit_events_count: auditLogs.length,
      sample_diffs: crmUpdates.slice(0, 5).map(u => ({
        lead_id: u.entity_id,
        before: u.before_state ? JSON.parse(u.before_state) : null,
        after: u.after_state ? JSON.parse(u.after_state) : null,
        details: u.details
      }))
    };

    return proofReport;
  }
}

module.exports = new SupervisorAgent();
