import dotenv from 'dotenv';

dotenv.config();

function rateNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

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
  API_PORT: Number(process.env.API_PORT) || 3000,
  API_HOST: process.env.API_HOST || '0.0.0.0',
  API_ALLOWED_ORIGINS: process.env.API_ALLOWED_ORIGINS
    ? process.env.API_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [],
  API_ALLOWED_IPS: process.env.API_ALLOWED_IPS
    ? process.env.API_ALLOWED_IPS.split(',').map((ip) => ip.trim())
    : [],
  WORLDS_QUERY_RATE_LIMIT: rateNumber(process.env.WORLDS_QUERY_RATE_LIMIT, 120),
  WORLDS_QUERY_RATE_WINDOW_MS: rateNumber(
    process.env.WORLDS_QUERY_RATE_WINDOW_MS,
    60000
  ),
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
