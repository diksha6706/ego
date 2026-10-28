# EGO Workforce AI

> **"One instruction. Multiple AI employees. Verified results."**
> Autonomous multi-agent orchestration for cross-platform enterprise business automation.

---

## 🚀 Quick Start (Run Locally)

The server is already installed and pre-configured. To start or restart the application anytime:

### 1. Prerequisites
- **Node.js**: v18+ (tested on Node v24.16.0 with native `node:sqlite`)
- **npm**: v9+

### 2. Start the Server
```bash
# Navigate to the workspace directory
cd /Users/diksha6706/Desktop/asdfghjkl

# Install dependencies (if running for the first time)
npm install

# Start the application
npm start
```
*(Or use `npm run dev` for auto-reloading during development)*

### 3. Open in Browser
Open your browser to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🧪 Run Automated Tests

To run the complete verification test suite (validating DAG cycle detection, lead qualification scoring, approval checkpoint gates, retry recovery, and SafeRun cryptographic proof):

```bash
npm test
```

Expected output:
```
✔ 1. DAG Validation & Security Allowlist
✔ 2. Lead Qualification Deterministic Scoring & Missing Data Flags
✔ 3. SafeRun Pre-Execution Preview & Transparent Risk Assessment
✔ 4. End-to-End Orchestrated Execution with Human Approval Gates
✔ 5. Controlled Tool Failure & Automated Bounded Retry
✔ EGO Workforce AI Test Suite (all tests passing)
```

---

## ⚙️ Environment Configuration

By default, the application runs in **Transparent Demo Mode** (zero API keys required, using deterministic planning, pre-seeded CRM database, and high-quality templates).

To connect a live hosted LLM (OpenAI):

1. Create a `.env` file in the root folder (or edit existing):
```bash
cp .env.example .env
```

2. Add your OpenAI API key in `.env`:
```env
PORT=3000
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o-mini
DEMO_MODE=false
```

3. Restart the server:
```bash
npm start
```
*Note: The frontend will automatically display `Hosted LLM: gpt-4o-mini` in the top right badge.*

---

## 🎯 How to Test the Complete Business Workflow

Follow these steps for a complete hackathon demo:

1. **Enter Business Request**:
   In the prompt box on the **Overview** tab, enter or click the preset:
   > *"Qualify today's new leads, update their CRM records, draft personalized follow-up emails, and ask me before sending."*

2. **Click "Generate Plan"**:
   - The Planner Agent dynamically creates a validated DAG of tasks.
   - **SafeRun: Dry-Run Simulation & Pre-Execution Risk Analysis** appears, displaying:
     - Expected leads to process, CRM updates, and email drafts.
     - Detected duplicate contacts and incomplete records.
     - Calculated Risk Index (0-100) and risk factors breakdown.
   - The **Live Task Graph** renders the planned tasks.

3. **Click "Approve Plan & Execute Workforce"**:
   - Tasks execute sequentially according to DAG dependencies:
     - `crm_fetch_leads`: Qualifies 20 fictional leads using deterministic scoring rules.
     - `crm_update_lead`: Updates CRM stages and logs before/after diffs in the audit trail.
     - `email_draft`: Personalizes email outreach for high/medium prospects.
   - Execution **pauses automatically** at the human checkpoint (`AWAITING_APPROVAL`).

4. **Interactive Human Approval**:
   - Navigate to the **Approval Center** tab (notice the notification badge).
   - Review pending email drafts. You can edit the subject line or message body inline.
   - Click **Approve** on one draft and **Reject** on another.

5. **SafeRun: Execution Proof**:
   - Return to the **Overview** tab. Once approved/rejected, the Supervisor dispatches only approved messages to the simulated email service.
   - The signature **EGO SafeRun: Execution Proof** card displays:
     - `PASSED_VERIFIED` badge with a SHA-256 cryptographic state fingerprint.
     - Audit comparison: Planned operations vs actual database changes.
     - Before/after state diffs directly inspected from SQLite.

6. **Test Tool Failure & Bounded Retry**:
   - Toggle the **Simulate Tool Failure** switch in the top header.
   - Run a new workflow. The mock CRM tool will encounter a transient 503 error, the Supervisor will intercept it, transition the node to `RETRYING`, and automatically succeed on retry.

---

## 🧱 Architecture & AI Workforce

- **Lead Qualification Agent** (`agents/leadQualification.js`): Deterministic scoring engine evaluating budget, timeline urgency, and solution fit.
- **CRM Updater Agent** (`agents/crmUpdater.js`): Database synchronization, deduplication engine, and before/after audit logger.
- **Email Drafting Agent** (`agents/emailDrafter.js`): Tailored executive outreach generator with mandatory safety boundary.
- **Supervisor Agent** (`agents/supervisor.js`): Approval gatekeeper, bounded retry orchestrator, and SafeRun cryptographic proof verifier.
- **Database** (`db.js`): Embedded SQLite database (`node:sqlite`) with 20 fictional leads pre-seeded idempotently.
