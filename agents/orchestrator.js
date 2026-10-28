const config = require('../config');
const dbService = require('../db');
const leadQualificationAgent = require('./leadQualification');
const crmUpdaterAgent = require('./crmUpdater');
const emailDraftingAgent = require('./emailDrafter');
const supervisorAgent = require('./supervisor');

/**
 * Orchestrator
 * Dependency-aware state machine orchestrating specialized AI workforce.
 * Enforces DAG constraints, manages retries, passes structured data between tasks,
 * and pauses at human approval checkpoints.
 */
class Orchestrator {
  constructor() {
    this.activeRuns = new Map();
  }

  async executeWorkflow(workflowId) {
    const workflow = dbService.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    dbService.updateWorkflow(workflowId, {
      status: 'RUNNING',
      duration_ms: 0
    });

    const startTime = Date.now();
    let intermediateContext = {};

    try {
      const result = await this.runWorkflowLoop(workflowId, intermediateContext);
      return result;
    } catch (err) {
      console.error(`[Orchestrator] Workflow ${workflowId} error:`, err);
      dbService.updateWorkflow(workflowId, {
        status: 'FAILED',
        duration_ms: Date.now() - startTime
      });
      throw err;
    }
  }

  async runWorkflowLoop(workflowId, context = {}) {
    const workflow = dbService.getWorkflow(workflowId);
    const tasks = dbService.getTasksByWorkflow(workflowId);

    // Track completed task outputs
    for (const t of tasks) {
      if (t.status === 'SUCCEEDED' && t.output) {
        context[t.id] = t.output;
      }
    }

    let madeProgress = true;

    while (madeProgress) {
      madeProgress = false;
      const currentTasks = dbService.getTasksByWorkflow(workflowId);

      // Find tasks ready to run
      for (const task of currentTasks) {
        if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'REJECTED') {
          continue;
        }

        // Check if task is paused waiting for human approval
        if (task.status === 'AWAITING_APPROVAL') {
          // Check if any drafts are still pending
          const drafts = dbService.getEmailDrafts(workflowId);
          const stillPending = drafts.filter(d => d.status === 'PENDING_APPROVAL');

          if (stillPending.length > 0) {
            // Still waiting for user approval in UI
            dbService.updateWorkflow(workflowId, { status: 'PAUSED_APPROVAL' });
            return {
              status: 'PAUSED_APPROVAL',
              workflow_id: workflowId,
              paused_task: task.id,
              pending_approvals_count: stillPending.length
            };
          } else {
            // Decisions have been recorded (all approved or rejected) -> transition back to RUNNING
            dbService.updateTask(task.id, { status: 'RUNNING' });
            dbService.updateWorkflow(workflowId, { status: 'RUNNING' });
            madeProgress = true;
          }
        }

        // Check dependencies
        const deps = task.dependencies || [];
        const allDepsSucceeded = deps.every(depId => {
          const depTask = currentTasks.find(t => t.id === depId);
          return depTask && depTask.status === 'SUCCEEDED';
        });

        if (!allDepsSucceeded) {
          // Dependencies not ready yet
          continue;
        }

        // Ready to execute this task!
        madeProgress = true;
        const taskResult = await this.executeSingleTask(task, context);

        if (taskResult.paused) {
          dbService.updateWorkflow(workflowId, { status: 'PAUSED_APPROVAL' });
          return {
            status: 'PAUSED_APPROVAL',
            workflow_id: workflowId,
            paused_task: task.id,
            pending_approvals_count: taskResult.pending_count || 1
          };
        }

        if (taskResult.failed) {
          dbService.updateWorkflow(workflowId, { status: 'FAILED' });
          return {
            status: 'FAILED',
            workflow_id: workflowId,
            failed_task: task.id,
            error: taskResult.error
          };
        }

        // Save output to context
        context[task.id] = taskResult.output;
      }
    }

    // Check final status
    const finalTasks = dbService.getTasksByWorkflow(workflowId);
    const hasFailures = finalTasks.some(t => t.status === 'FAILED');
    const allFinished = finalTasks.every(t => t.status === 'SUCCEEDED' || t.status === 'REJECTED');

    const wf = dbService.getWorkflow(workflowId);
    const duration = wf.created_at ? Math.max(0, Date.now() - new Date(wf.created_at).getTime()) : 0;

    if (allFinished) {
      dbService.updateWorkflow(workflowId, {
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        duration_ms: duration
      });
      return { status: 'COMPLETED', workflow_id: workflowId, duration_ms: duration };
    } else if (hasFailures) {
      dbService.updateWorkflow(workflowId, {
        status: 'FAILED',
        completed_at: new Date().toISOString(),
        duration_ms: duration
      });
      return { status: 'FAILED', workflow_id: workflowId };
    }

    return { status: 'IN_PROGRESS', workflow_id: workflowId };
  }

  async executeSingleTask(task, context) {
    const taskStart = Date.now();
    dbService.updateTask(task.id, {
      status: 'RUNNING',
      started_at: new Date().toISOString()
    });

    let attempt = task.retries || 0;
    const maxRetries = task.max_retries || 2;

    while (attempt <= maxRetries) {
      try {
        // Collect inputs from dependencies
        let inputData = null;
        if (task.dependencies && task.dependencies.length > 0) {
          const lastDep = task.dependencies[task.dependencies.length - 1];
          inputData = context[lastDep] || null;
        } else if (context.inputData) {
          inputData = context.inputData;
        }

        const taskContext = {
          ...task,
          inputData
        };

        let result = null;

        // Route to assigned worker and tool
        switch (task.tool) {
          case 'crm_fetch_leads':
            result = await leadQualificationAgent.run(taskContext);
            break;

          case 'crm_update_lead':
            result = await crmUpdaterAgent.run(taskContext);
            break;

          case 'email_draft':
            result = await emailDraftingAgent.run(taskContext);
            break;

          case 'email_send_simulated':
            result = await supervisorAgent.executeSimulatedEmailSend(taskContext);
            if (result && result.status === 'AWAITING_APPROVAL') {
              dbService.updateTask(task.id, {
                status: 'AWAITING_APPROVAL',
                duration_ms: Date.now() - taskStart
              });
              return { paused: true, pending_count: result.pending_count };
            }
            break;

          case 'audit_verify':
            result = await supervisorAgent.runAuditVerification(taskContext);
            break;

          default:
            throw new Error(`Unknown or unauthorized tool: ${task.tool}`);
        }

        // Succeeded!
        dbService.updateTask(task.id, {
          status: 'SUCCEEDED',
          output_json: result,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - taskStart
        });

        return { success: true, output: result };
      } catch (err) {
        attempt++;
        console.warn(`[Orchestrator] Task ${task.id} attempt ${attempt} failed:`, err.message);

        // If failure was simulated via toggle, automatically clear it for bounded recovery!
        if (dbService.getSystemState('simulate_tool_failure') === 'true') {
          console.log('[Orchestrator] Clearing simulated tool failure switch for automatic bounded retry recovery.');
          dbService.setSystemState('simulate_tool_failure', 'false');
        }

        if (attempt <= maxRetries) {
          dbService.updateTask(task.id, {
            status: 'RETRYING',
            retries: attempt,
            error_message: `Retry ${attempt}/${maxRetries} scheduled. Previous error: ${err.message}`
          });
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 600));
        } else {
          // Max retries exceeded
          dbService.updateTask(task.id, {
            status: 'FAILED',
            retries: attempt - 1,
            error_message: err.message,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - taskStart
          });
          return { failed: true, error: err.message };
        }
      }
    }

    return { failed: true, error: 'Maximum retries exceeded' };
  }

  /**
   * Resumes a paused workflow after human approval decision
   */
  async resumeWorkflow(workflowId) {
    console.log(`[Orchestrator] Resuming workflow ${workflowId} after human approval event...`);
    return await this.runWorkflowLoop(workflowId);
  }
}

module.exports = new Orchestrator();
