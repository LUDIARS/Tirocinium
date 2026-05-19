import postgres from 'postgres';
import { config } from '../config.js';

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  prepare: false,
});

export type Sql = typeof sql;
