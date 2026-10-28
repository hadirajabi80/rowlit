import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../../api/types';
import { buildTree, nodeId, type TreeInput } from './tree';

function input(providerId: ConnectionProfile['providerId'], expanded: string[]): TreeInput {
  const c = { id: 'c1', name: 'Test', providerId, props: {}, readOnly: false } as ConnectionProfile;
  return { connections: [c], conns: { c1: { status: 'loading' } as never }, dbs: {}, expanded: new Set(expanded), collapsedFolders: new Set(), filter: '' };
}
describe('security explorer group', () => {
  it('adds users and roles for supported relational providers', () => {
    const rows = buildTree(input('postgresql', [nodeId.conn('c1'), nodeId.security('c1')]));
    expect(rows.filter((r) => r.kind === 'security').map((r) => r.label)).toEqual(['Security', 'Users', 'Roles']);
  });
  it('does not add security to SQLite', () => {
    expect(buildTree(input('sqlite', [nodeId.conn('c1')]))).not.toContainEqual(expect.objectContaining({ kind: 'security' }));
  });
});
