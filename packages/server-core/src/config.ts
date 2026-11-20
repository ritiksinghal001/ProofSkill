import { z } from 'zod';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const Env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATA_DIR: z.string().default('./data'),
  AI_PROVIDER: z.enum(['fixture', 'anthropic']).default('fixture'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().default(45000),
  GITHUB_TOKEN: z.string().optional(),
  MCQ_PER_SKILL: z.coerce.number().int().min(1).default(10),
  MCQ_TIMED: bool,
  MCQ_MINUTES_PER_SKILL: z.coerce.number().default(15),
  MAX_RESUME_MB: z.coerce.number().default(5),
  MAX_ZIP_MB: z.coerce.number().default(25),
  MAX_EXTRACTED_MB: z.coerce.number().default(100),
  MAX_ZIP_ENTRIES: z.coerce.number().default(5000),
  MAX_FILE_MB: z.coerce.number().default(1),
  JOB_MAX_ATTEMPTS: z.coerce.number().default(3),
  WORKER_POLL_MS: z.coerce.number().default(700),
});
const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid configuration. See .env.example.');
}
export const config = {
  ...parsed.data,
  dataDir: path.resolve(repoRoot, parsed.data.DATA_DIR), // relative paths resolve from the repo root, whichever workspace a process starts in
  aiMode: parsed.data.AI_PROVIDER === 'anthropic' && parsed.data.AI_API_KEY ? ('LIVE' as const) : ('FIXTURE' as const),
};
