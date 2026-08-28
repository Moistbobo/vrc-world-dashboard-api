import dotenv from 'dotenv';

dotenv.config();

const Config = {
  VRC_USERNAME: process.env.VRC_USERNAME,
  VRC_PASSWORD: process.env.VRC_PASSWORD,
  VRC_TOTP_KEY: process.env.VRC_TOTP_KEY,
  WORLD_NAME_MATCHERS: process.env?.WORLD_NAME_MATCHERS
    ? process.env.WORLD_NAME_MATCHERS.split(',')
    : [],
  AUTHOR_NAME_MATCHERS: process.env?.AUTHOR_NAME_MATCHERS
    ? process.env.AUTHOR_NAME_MATCHERS.split(',')
    : [],
  DATABASE_PATH: process.env.DATABASE_PATH || './worlds.db',
  DATABASE_URL: process.env.DATABASE_URL || '',
  LLM_EXTRACTOR_URL: process.env.LLM_EXTRACTOR_URL || '',
  LLM_EXTRACTOR_TIMEOUT_MS:
    Number(process.env.LLM_EXTRACTOR_TIMEOUT_MS) || 10000,
  API_PORT: Number(process.env.API_PORT) || 3000,
  API_HOST: process.env.API_HOST || '0.0.0.0',
  API_ALLOWED_ORIGINS: process.env.API_ALLOWED_ORIGINS
    ? process.env.API_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [],
  API_ALLOWED_IPS: process.env.API_ALLOWED_IPS
    ? process.env.API_ALLOWED_IPS.split(',').map((ip) => ip.trim())
    : [],
  DEV: process.env.DEV === 'true',
  DISABLE_API_RESTRICTIONS:
    process.env.DISABLE_API_RESTRICTIONS === 'true' ||
    process.env.DEV === 'true',
  AXIOM_TOKEN: process.env.AXIOM_TOKEN || '',
  AXIOM_DATASET: process.env.AXIOM_DATASET || '',
  AXIOM_EDGE: process.env.AXIOM_EDGE || '',
  AXIOM_ORG_ID: process.env.AXIOM_ORG_ID || ''
};

export default Config;
