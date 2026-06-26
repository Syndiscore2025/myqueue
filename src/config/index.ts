import { parseEnv, type Env } from './env';

/**
 * Validated, immutable application configuration.
 *
 * Importing this module triggers environment validation exactly once. Any
 * invalid configuration aborts process startup with a descriptive error.
 */
export const env: Readonly<Env> = Object.freeze(parseEnv());

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

export type { Env };
