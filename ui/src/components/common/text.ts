// Small UI text helpers shared by the shell components.
import type { ConnectionActivity } from '../../store/sessions';

/** "1 session" / "3 sessions" / "1 batch" / "2 batches"; `plural` defaults to `${singular}s`. */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

/** The word alone: "row" / "rows" (when the number is formatted elsewhere). */
export function pluralWord(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : plural;
}

/** Title of the explorer's connected dot: says which kind of "connected" it is. */
export function activityTitle(a: ConnectionActivity): string {
  if (!a) return 'Not connected';
  if (a.kind === 'session') return `Connected · ${pluralize(a.sessions, 'open session')}`;
  if (a.kind === 'client') return 'Connected';
  // Resources: nothing held on the server; released sessions reconnect on the next run.
  if (a.released) return `Disconnected · ${pluralize(a.released, 'session')} ${a.released === 1 ? 'reconnects' : 'reconnect'} on the next run`;
  return 'Not connected · catalog cached';
}
