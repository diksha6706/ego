const dbService = require('../db');

/**
 * Lead Qualification Agent
 * Evaluates prospect records from CRM based on budget, purchase intent, and business fit.
 * Uses deterministic scoring rules and flags missing information instead of fabricating data.
 */
class LeadQualificationAgent {
  constructor() {
    this.name = 'Lead Qualification Agent';
  }

  evaluateLead(lead) {
    const missingFields = [];
    let score = 0;
    const reasons = [];

    // 1. Budget Evaluation (up to 40 pts)
    const budget = lead.budget_num;
    if (budget === null || budget === undefined || isNaN(budget)) {
      missingFields.push('budget_range');
      reasons.push('Budget information is missing (0/40 pts)');
    } else if (budget >= 100000) {
      score += 40;
      reasons.push(`Enterprise budget confirmed: $${budget.toLocaleString()} (40/40 pts)`);
    } else if (budget >= 50000) {
      score += 30;
      reasons.push(`Mid-market budget: $${budget.toLocaleString()} (30/40 pts)`);
    } else if (budget >= 20000) {
      score += 20;
      reasons.push(`Growth budget: $${budget.toLocaleString()} (20/40 pts)`);
    } else {
      score += 5;
      reasons.push(`Entry-tier budget: $${budget.toLocaleString()} (5/40 pts)`);
    }

    // 2. Purchase Intent Evaluation (up to 35 pts)
    const intent = (lead.purchase_intent || '').toLowerCase().trim();
    if (!intent) {
      missingFields.push('purchase_intent');
      reasons.push('Purchase intent is unspecified (0/35 pts)');
    } else if (intent.includes('immediate')) {
      score += 35;
      reasons.push('Immediate purchase timeline identified (35/35 pts)');
    } else if (intent.includes('1-3') || intent.includes('month') || intent.includes('quarter')) {
      score += 25;
      reasons.push('Active 1-3 month evaluation window (25/35 pts)');
    } else if (intent.includes('explor')) {
      score += 10;
      reasons.push('General exploratory phase (10/35 pts)');
    } else {
      reasons.push('No active purchase urgency identified (0/35 pts)');
    }

    // 3. Product & Business Fit (up to 25 pts)
    const interest = lead.product_interest;
    if (!interest) {
      missingFields.push('product_interest');
      reasons.push('Product interest not specified (0/25 pts)');
    } else if (
      interest.toLowerCase().includes('orchestrat') ||
      interest.toLowerCase().includes('agent') ||
      interest.toLowerCase().includes('workflow') ||
      interest.toLowerCase().includes('autonomous') ||
      interest.toLowerCase().includes('dispatch')
    ) {
      score += 25;
      reasons.push(`Strong core architecture alignment: "${interest}" (25/25 pts)`);
    } else {
      score += 15;
      reasons.push(`Peripheral solution interest: "${interest}" (15/25 pts)`);
    }

    // Missing contact check
    if (!lead.email) {
      missingFields.push('email');
      reasons.push('Notice: No valid contact email on file');
    }

    // Categorization
    let priority = 'Low';
    if (score >= 70) {
      priority = 'High';
    } else if (score >= 40) {
      priority = 'Medium';
    }

    const qualificationReason = reasons.join('; ');

    return {
      lead_id: lead.id,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      score,
      priority,
      qualificationReason,
      missingFields,
      hasMissingData: missingFields.length > 0
    };
  }

  async run(taskContext) {
    const leads = dbService.getAllLeads();
    const evaluated = [];

    let highCount = 0;
    let medCount = 0;
    let lowCount = 0;
    let flaggedIncomplete = 0;

    for (const lead of leads) {
      const result = this.evaluateLead(lead);
      evaluated.push(result);
      if (result.priority === 'High') highCount++;
      else if (result.priority === 'Medium') medCount++;
      else lowCount++;

      if (result.hasMissingData) flaggedIncomplete++;
    }

    return {
      agent: this.name,
      total_evaluated: evaluated.length,
      high_priority: highCount,
      medium_priority: medCount,
      low_priority: lowCount,
      flagged_incomplete: flaggedIncomplete,
      evaluations: evaluated
    };
  }
}

module.exports = new LeadQualificationAgent();
