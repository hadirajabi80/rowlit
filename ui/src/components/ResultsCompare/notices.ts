// Things the user should know before trusting the numbers of a comparison.
import { formatCount } from '../../lib/format';
import { pluralize } from '../common/text';
import type { DiffResult } from './diff';
import type { CompareSet } from './sources';

export function noticesOf(diff: DiffResult, left: CompareSet, right: CompareSet, keys: string[]): string[] {
  const out: string[] = [];
  for (const [letter, s] of [['A', left], ['B', right]] as const) {
    if (!s.complete) {
      out.push(`${letter} (${s.title}) holds ${formatCount(s.rows.length)} of ${formatCount(s.rowCount)} rows or is still loading; the other rows are not compared.`);
    }
  }
  if (diff.droppedKeys.length) {
    out.push(`Key column${diff.droppedKeys.length === 1 ? '' : 's'} ${diff.droppedKeys.join(', ')} ${diff.droppedKeys.length === 1 ? 'is' : 'are'} missing from one result and ignored.`);
  }
  if (diff.duplicateKeys > 0) out.push(`${pluralize(diff.duplicateKeys, 'row')} share a key with another row and are paired in order. Add key columns to match them reliably.`);
  if (diff.keyColumns.length === 0 && keys.length === 0) out.push('No key columns: whole rows are compared, so a changed row appears as one removed and one added row.');
  const onlyA = diff.columns.filter((c) => c.right === null).map((c) => c.name);
  const onlyB = diff.columns.filter((c) => c.left === null).map((c) => c.name);
  if (onlyA.length) out.push(`Only in A, not compared: ${onlyA.join(', ')}.`);
  if (onlyB.length) out.push(`Only in B, not compared: ${onlyB.join(', ')}.`);
  if (diff.kindMismatches.length) out.push(`Different types in A and B (compared as text): ${diff.kindMismatches.join(', ')}.`);
  return out;
}
