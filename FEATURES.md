# EGO Workforce AI — Complete Feature Specification & Architecture

> **Tagline**: *"One instruction. Multiple AI employees. Verified results."*  
> **Problem Statement**: *"Autonomous multi-agent orchestration for cross-platform enterprise business automation."*

---

## 📑 Table of Contents

1. [Product Overview & Architecture](#1-product-overview--architecture)
2. [Feature 1: Natural-Language Planner Agent](#2-feature-1-natural-language-planner-agent)
3. [Feature 2: Specialized AI Workforce (4 Agents)](#3-feature-2-specialized-ai-workforce-4-agents)
4. [Feature 3: Simulated Business Tools & Enterprise Data](#4-feature-3-simulated-business-tools--enterprise-data)
5. [Signature Differentiator: EGO SafeRun](#5-signature-differentiator-ego-saferun)
6. [Feature 4: Interactive Approval Checkpoint (Human-in-the-Loop)](#6-feature-4-interactive-approval-checkpoint-human-in-the-loop)
7. [Feature 5: Live Task Graph (DAG) & Execution Dashboard](#7-feature-5-live-task-graph-dag--execution-dashboard)
8. [Feature 6: Controlled Failure & Bounded Retry Recovery](#8-feature-6-controlled-failure--bounded-retry-recovery)
9. [Feature 7: Dual LLM Engine (OpenRouter + OpenAI + Heuristic Fallback)](#9-feature-7-dual-llm-engine-openrouter--openai--heuristic-fallback)
10. [Feature 8: Security & Allowlisting Architecture](#10-feature-8-security--allowlisting-architecture)
11. [Feature 9: Complete REST API Reference](#11-feature-9-complete-rest-api-reference)
12. [Feature 10: Verification Test Suite](#12-feature-10-verification-test-suite)

---

## 1. Product Overview & Architecture

**EGO Workforce AI** is a full-stack multi-agent autonomous workforce platform designed for high-stakes enterprise operations. Instead of brittle chatbot scripts, it coordinates specialized AI workers governed by a dependency-aware state machine, safety allowlists, human-in-the-loop approval gates, and cryptographic execution proofs.

### Tech Stack
- **Backend Runtime**: Node.js v24+ (native `node:sqlite` DatabaseSync)
- **Framework**: Express.js REST API with real-time polling updates
- **Database**: SQLite embedded engine (`ego_workforce.db`) with zero external native compilation dependencies
- **LLM Integration**: OpenAI SDK compatible with Hosted OpenAI API and OpenRouter API (`openai/gpt-4o-mini`)
- **Frontend**: Responsive Vanilla CSS & JavaScript SaaS dashboard with dark obsidian glassmorphism, Google Fonts (*Outfit* and *Inter*), micro-animations, and SVG icons.

---

## 2. Feature 1: Natural-Language Planner Agent

Accepts high-level business goals and synthesizes a validated **Directed Acyclic Graph (DAG)** of discrete subtasks.

- **Dynamic Task Graph Generation**:
  - Different business requests generate tailored execution graphs.
  - Pre-built presets include:
    1. *Standard Lead Follow-up*: `"Qualify today's new leads, update their CRM records, draft personalized follow-up emails, and ask me before sending."`
    2. *Enterprise Pipeline*: `"Filter enterprise leads with budget over $80k, update pipeline stages, draft executive briefings, and require my approval before outreach."`
    3. *Data Integrity Audit*: `"Audit all newly received leads, detect duplicates, flag missing contact records, and verify CRM data integrity with SafeRun proof."`
- **Strict DAG Validation**:
  - **Cycle Detection**: Depth-First Search (DFS) with recursion stacks detects and rejects cyclical dependencies.
  - **Orphan Reference Checking**: All task dependencies must map to existing task IDs.
  - **Tool Allowlist Guard**: Validates that all requested tools exist strictly in `ALLOWLISTED_TOOLS`.
- **Workflow Namespacing**: Every workflow plan isolates task IDs (e.g., `WF-XXXXX-TASK-01`) preventing database uniqueness collisions across multiple concurrent executions.

---

## 3. Feature 2: Specialized AI Workforce (4 Agents)

Four distinct workers, each assigned strict responsibilities, data access boundaries, and allowlisted tools.

### Agent A: Lead Qualification Agent
- **Tool**: `crm_fetch_leads`
- **Deterministic 0–100 Scoring Engine**:
  - **Budget Score (0–40 pts)**: Enterprise (≥$100k) = 40 pts, Mid-market ($50k–$99k) = 30 pts, Growth ($20k–$49k) = 20 pts, Entry (<$20k) = 5 pts, Missing = 0 pts.
  - **Intent Urgency (0–35 pts)**: `Immediate` = 35 pts, `1-3 Months` = 25 pts, `Exploring` = 10 pts, `None` = 0 pts.
  - **Product Alignment (0–25 pts)**: High match with autonomous workflow / multi-agent orchestration = 25 pts, peripheral interest = 15 pts.
- **Priority Tiers**: High (≥70), Medium (40–69), Low (<40).
- **Zero Fabrication Rule**: Flags missing fields (`missing_fields: ["budget_range", "email"]`) instead of inventing facts.

### Agent B: CRM Updater Agent
- **Tool**: `crm_update_lead`
- **Deduplication Engine**: Scans incoming contacts against existing records by normalized email and company identity to prevent duplicate records.
- **State Synchronization**: Updates CRM records to `Qualified`, `Unqualified`, or `Duplicate - Merged`.
- **Immutable Audit Logging**: Records exact `before_state` and `after_state` diffs for every update in the `audit_logs` table.

### Agent C: Email Drafting Agent
- **Tool**: `email_draft`
- **Hosted LLM Personalization**: Uses `openai/gpt-4o-mini` (or deterministic template fallback) to write custom executive emails.
- **Context Injection**: References prospect name, company name, specific product interest, and stated budget tier.
- **Mandatory Safety Boundary**: Saves drafts to the database with status `PENDING_APPROVAL`. Never dispatches messages directly.

### Agent D: Supervisor Agent
- **Tools**: `email_send_simulated`, `audit_verify`
- **Approval Gatekeeper**: Rejects any attempt to send unapproved or rejected drafts.
- **Bounded Retry Manager**: Intercepts transient tool failures and coordinates bounded retries (up to 2 attempts) with backoff.
- **Cryptographic Verifier**: Inspects database state post-execution and issues the EGO SafeRun Execution Proof.

---

## 4. Feature 3: Simulated Business Tools & Enterprise Data

- **20 Pre-Seeded Fictional Enterprise Leads**:
  - High-value accounts: *Apex Logistics Global*, *BioSyn Health Analytics*, *Sterling & Croft Capital*, *Veritas Cyber Defense*.
  - Growth accounts: *Solaria Solar Dynamics*, *Dublin Data Foundry*.
  - Entry/low accounts: *Wright Handyman Services*, *Arthur Pendelton (Freelance Dev)*.
  - Incomplete records: Missing email (*Quantum Matrix Systems*), missing budget (*Apex Logistics Lead 115*), missing product interest (*Holt Agricultural Logistics*).
  - Duplicate identities: Duplicate emails and duplicate company accounts.
- **Idempotent Seed Operation**: The "Reset Demo CRM" button resets all leads, workflows, drafts, and logs back to a pristine state without duplicates.
- **Simulated Email Gateway**: Approved emails create a database record in `simulated_emails` with:
  `message_id`, `recipient`, `subject`, `body`, `approval_status`, `simulated_delivery_status: 'SIMULATED_DELIVERED'`, and `sent_at`.
- **Obvious Simulation Disclaimers**: Disclaimers clearly disclose that all network transmissions are simulated locally.

---

## 5. Signature Differentiator: EGO SafeRun

**"Preview Before Action, Proof After Execution"**

### Phase A: Pre-Execution Simulation (Preview)
Calculates projected system changes before any task runs:
- Tasks planned to execute.
- Projected CRM update volume.
- Projected personalized email drafts.
- Pre-detected duplicate records and missing data fields.
- **Zero Side Effects**: Preview reads from SQLite without modifying records.

### Phase B: Transparent Autonomous Risk Evaluation
Calculates an explainable **Risk Index (0–100)**:
- *Incomplete Data Risk*: Penalizes missing emails and budgets (+8 pts per record, capped at +25).
- *Duplicate Contact Risk*: Penalizes duplicate identity collisions (+10 pts per record, capped at +20).
- *Database Write Risk*: +15 pts for bulk write operations.
- *External Outreach Risk*: +25 pts for external communications.
- *Human Gate Mitigation*: -20 pts mitigation applied when human approval checkpoints are active.
- *Risk Badges*: LOW (0–35), MEDIUM (36–65), HIGH (66–100).

### Phase C: Orchestrated Execution
- Runs the validated DAG through the state machine.
- Emits real-time task status updates.

### Phase D: Post-Execution Execution Proof
Independently inspects SQLite storage after the run:
- **Planned vs Actual Comparison**: Compares planned tasks against completed, failed, and retried tasks.
- **Audit Diff Inspection**: Shows exact `before_state` vs `after_state` JSON diffs.
- **Cryptographic Fingerprint**: Computes a SHA-256 hash of the execution outcome.
- **Proof Badge**: Displays `PASSED_VERIFIED` (or `FAILED_VERIFICATION` if unexpected drift occurred).

---

## 6. Feature 4: Interactive Approval Checkpoint (Human-in-the-Loop)

- **Execution Pause**: When an email draft task completes, the subsequent simulated dispatch task pauses with status `AWAITING_APPROVAL`.
- **Approval Center Tab**:
  - Displays pending drafts with recipient, company, lead ID, and risk explanations.
  - **Inline Editing**: Reviewers can edit both the subject line and body text directly before deciding.
  - **Approve Action**: Transitions draft to `APPROVED`.
  - **Reject Action**: Prompts for a rejection reason (e.g., *"Budget mismatch"*) and transitions draft to `REJECTED`.
- **Strict Enforcement**:
  - Only approved drafts are processed by the simulated email service.
  - Rejected drafts are blocked from dispatch.
  - Resumes execution automatically once all pending drafts have been decided.

---

## 7. Feature 5: Live Task Graph (DAG) & Execution Dashboard

- **Real-Time Visual DAG**: Displays task sequence, dependencies, assigned agent, and tool.
- **Supported Task States**:
  - `PLANNED`: Task scheduled in DAG.
  - `QUEUED`: Waiting for upstream dependencies to finish.
  - `RUNNING`: Actively executing (animated cyan pulse).
  - `AWAITING_APPROVAL`: Paused at human gate (animated amber warning).
  - `SUCCEEDED`: Verified successful completion.
  - `FAILED`: Execution terminated with error.
  - `RETRYING`: Transient error handled; scheduled for bounded retry.
  - `REJECTED`: Halted due to human disapproval.
- **Interactive Output Drawers**: Clickable drawer on each task showing duration, retry count, and formatted JSON output.

---

## 8. Feature 6: Controlled Failure & Bounded Retry Recovery

- **Simulate Tool Failure Toggle**:
  - Located in the dashboard header.
  - Injects a controlled transient `503 CRM_CONNECTION_TIMEOUT` error into the next CRM operation.
- **Autonomous Recovery Cycle**:
  1. Tool throws transient 503 error.
  2. Supervisor intercepts error and transitions task to `RETRYING` (attempt 1/2).
  3. Automatically clears the simulation switch.
  4. Waits 600ms backoff and retries the operation.
  5. The retry succeeds idempotently without duplicate records.
  6. Task status transitions to `SUCCEEDED`.

---

## 9. Feature 7: Dual LLM Engine (OpenRouter + OpenAI + Heuristic Fallback)

- **OpenRouter Compatible**: Automatically configures `https://openrouter.ai/api/v1` when an `sk-or-` API key is detected.
- **Direct OpenAI Compatible**: Supports standard OpenAI API keys (`sk-...`) targeting `gpt-4o-mini` or `gpt-4o`.
- **Transparent Fallback Mode**: If the key is missing or encounters a `429 Quota Exceeded` error, the application automatically enters **Deterministic Fallback Mode** with transparent UI badges, ensuring the demo never breaks.

---

## 10. Feature 8: Security & Allowlisting Architecture

- **Zero Client-Side Secrets**: All API credentials stay in backend environment variables (`.env`).
- **Git Protection**: [`.gitignore`](file:///Users/diksha6706/Desktop/asdfghjkl/.gitignore) prevents `.env` and `.db` files from being committed.
- **Tool Allowlist**:
  - `crm_fetch_leads`
  - `crm_update_lead`
  - `email_draft`
  - `email_send_simulated`
  - `audit_verify`
  - Any unauthorized tool name (e.g., shell commands, raw SQL) is rejected with a `Security Violation`.

---

## 11. Feature 9: Complete REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/config` | Returns system config, active LLM model, and demo mode status. |
| `GET` | `/api/stats` | Returns real-time counts for leads, workflows, pending approvals, and sends. |
| `GET` | `/api/leads` | Fetches all 20 CRM leads with qualification scores and statuses. |
| `POST` | `/api/leads/seed` | Resets/reseeds CRM leads idempotently (`{ force: true }`). |
| `POST` | `/api/plan` | Generates a validated task DAG and SafeRun preview from natural language. |
| `POST` | `/api/workflows/:id/execute` | Starts execution of a validated workflow. |
| `GET` | `/api/workflows/:id` | Returns live workflow status, task states, drafts, and audit logs. |
| `GET` | `/api/workflows` | Returns history of past workflow runs. |
| `GET` | `/api/approvals` | Fetches all email drafts currently awaiting human approval. |
| `POST` | `/api/approvals/:id/decide` | Records human decision (`approve` or `reject`) and resumes workflow. |
| `PUT` | `/api/approvals/:id/draft` | Updates subject and body of a pending draft. |
| `POST` | `/api/simulate-failure` | Toggles the transient 503 tool failure switch. |
| `GET` | `/api/audit-logs` | Returns immutable audit trail entries with before/after state diffs. |

---

## 12. Feature 10: Verification Test Suite

Run anytime via:
```bash
npm test
```

### Verified Scenarios:
1. **DAG Validation**: Verifies cycle detection, self-dependencies, and unauthorized tool rejections.
2. **Deterministic Scoring**: Verifies score calculations, missing data flags, and priority classifications.
3. **SafeRun Preview**: Verifies pre-execution estimates and transparent risk scoring.
4. **Approval Enforcement**: Verifies execution pauses at gates, only approved drafts are sent, and rejected drafts are blocked.
5. **Tool Failure & Recovery**: Verifies 503 transient error injection, retry increments, and automated recovery.
