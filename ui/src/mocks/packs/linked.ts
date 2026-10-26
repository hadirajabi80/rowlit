// Linked databases mock pack (plan-links WP-C): the 'linked' provider entry, a sample link over the mock connections,
// its catalog and the /links routes (validate, catalog, compile, parse, plan, views, materialize, native-script).
// WP0 stub: inert (no provider, no connection), so the existing mock experience and tests do not change. WP-C owns
// this file; the sample link is exported for WP-C to list in `connections` together with the provider entry.
import type { ConnectionProfile } from '../../api/types';
import { PACK_NOW, type MockProviderPack } from './types';

/** Sample link (folder "Linked databases") over the mock SQLite and PostgreSQL shops. */
export const linkedConnections: ConnectionProfile[] = [
  { id: 'c_link', name: 'Sales (linked)', providerId: 'linked', color: null, folder: 'Linked databases', readOnly: true,
    props: {
      linkVersion: 1,
      members: [
        { alias: 'shop', kind: 'connection', connectionId: 'c_shop', schema: 'main', allTables: true, tables: [] },
        { alias: 'crm', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false,
          tables: [{ name: 'customers', type: 'table' }] },
      ],
      relations: [],
      options: {},
    },
    hasPassword: false, savePassword: false, createdAt: PACK_NOW, lastUsedAt: null },
];

export const linkedPack: MockProviderPack = {
  providers: [],
  connections: [],
  extraObjects: {},
  handlers: () => [],
};
