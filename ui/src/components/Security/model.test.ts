import { describe, expect, it } from 'vitest';
import { blankChange, filterPrincipals } from './model';
const rows = [
  { name: 'alice', kind: 'user' as const, host: null, canLogin: true, disabled: false, system: false, detail: null },
  { name: 'analyst', kind: 'role' as const, host: null, canLogin: false, disabled: false, system: false, detail: null },
];
describe('security model', () => {
  it('filters roles and searches names', () => { expect(filterPrincipals(rows, 'roles', '')).toHaveLength(1); expect(filterPrincipals(rows, 'all', 'ALIC')).toEqual([rows[0]]); });
  it('builds a conservative blank grant', () => { expect(blankChange('grant', 'user', 'alice')).toMatchObject({ name: 'alice', objectType: 'table', privileges: ['SELECT'] }); });
});
