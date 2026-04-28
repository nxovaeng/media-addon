import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  PORT: z.string().default('3000'),
  TMDB_API_KEY: z.string().optional(),
  BANGUMI_API_URL: z.string().default('https://api.bgm.tv'),
  MEDIAFLOW_PROXY_URL: z.string().optional(),
  MEDIAFLOW_API_PASSWORD: z.string().optional(),
  FEBBOX_TOKEN: z.string().optional(),
  ACCESS_TOKENS: z.string().optional(),
  ACTIVE_AGGREGATORS: z.string().optional(),
  REGION: z.enum(['all', 'mainland', 'overseas']).default('all'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export const config = configSchema.parse(process.env);

export const allowedAccessTokens = config.ACCESS_TOKENS
  ? config.ACCESS_TOKENS.split(',').map((token) => token.trim()).filter(Boolean)
  : [];

export const activeAggregators = config.ACTIVE_AGGREGATORS
  ? config.ACTIVE_AGGREGATORS.split(',').map((item) => item.trim()).filter(Boolean)
  : [];

export type Config = z.infer<typeof configSchema>;
