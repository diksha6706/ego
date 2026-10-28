require('dotenv').config();

const apiKey = process.env.OPENAI_API_KEY || '';
const isKeyPresent = Boolean(apiKey && apiKey.trim().length > 0);
const isOpenRouter = apiKey.startsWith('sk-or-');
const defaultBaseUrl = isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined;
const defaultModel = isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

module.exports = {
  PORT: process.env.PORT || 3000,
  OPENAI_API_KEY: apiKey,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || defaultBaseUrl,
  OPENAI_MODEL: process.env.OPENAI_MODEL || defaultModel,
  DEMO_MODE: process.env.DEMO_MODE === 'true' || !isKeyPresent,
  MAX_RETRIES: 2,
  ALLOWLISTED_TOOLS: [
    'crm_fetch_leads',
    'crm_update_lead',
    'email_draft',
    'email_send_simulated',
    'audit_verify'
  ]
};
