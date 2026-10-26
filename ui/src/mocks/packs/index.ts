// Batch 3 mock packs (plan-batch3 WP0). One per work package; this list never changes after WP0.
import type { MockProviderPack } from './types';
import { mysqlPack } from './mysql';
import { clickhousePack } from './clickhouse';
import { snowflakePack } from './snowflake';
import { cassandraPack } from './cassandra';
import { elasticsearchPack } from './elasticsearch';
// LINKS-WP0: linked databases (WP-C owns ./linked.ts)
import { linkedPack } from './linked';

export const MOCK_PACKS: readonly MockProviderPack[] = [mysqlPack, clickhousePack, snowflakePack, cassandraPack, elasticsearchPack, linkedPack];

export type { MockProviderPack } from './types';
