// Step 2: where the rows go - a connection > database > schema, or a SQL script file in a chosen dialect (a dump).
import { Database, FileCode2, FolderOpen } from 'lucide-react';
import type { Ref } from 'react';
import { getPlatform } from '../../platform';
import { Callout, Field, StepHeader } from '../ImportWizard/parts';
import { dumpPathIssue, normalizeDumpPath, suggestedDumpName } from './model';
import { levelOf } from './labels';
import { Crumb } from './SourceStep';
import type { Transfer } from './useTransfer';

export function TargetStep({ t, headingRef }: { t: Transfer; headingRef: Ref<HTMLHeadingElement> }) {
  const { s, patch } = t;
  const platform = getPlatform();
  const level = levelOf(t.targetConn?.providerId);
  const dialect = t.dumpDialects?.find((d) => d.provider === s.dumpProvider);
  const pathIssue = s.filePath.trim() ? dumpPathIssue(s.filePath) : null;

  const browse = async () => {
    const name = suggestedDumpName(s.sourceSchema ?? t.sourceDb, dialect?.name ?? 'sql');
    const path = await platform.showSaveDialog({
      title: 'Write the SQL script to', defaultPath: s.filePath.trim() || name, filters: [{ name: 'SQL script', extensions: ['sql'] }],
    });
    if (path) patch({ filePath: path });
  };

  const sameAsSource = s.targetKind === 'connection' && s.targetCid === t.cid && (s.targetDb ?? null) === (t.sourceDb ?? null)
    && (s.targetSchema.trim() || t.target.defaultSchema) === (s.sourceSchema ?? t.source.defaultSchema);

  return (
    <section className="iw-step" aria-labelledby="tr-tgt-title">
      <StepHeader
        ref={headingRef}
        id="tr-tgt-title"
        title="Choose where to copy"
        help="Copy into another connection (any provider), or write everything as a SQL script you can run later: a portable dump."
      />

      <div className="iw-card">
        <div className="iw-seg" role="radiogroup" aria-label="Target kind">
          <label className={`iw-radio${s.targetKind === 'connection' ? ' on' : ''}`}>
            <input type="radio" name="tr-target" checked={s.targetKind === 'connection'} onChange={() => patch({ targetKind: 'connection' })} />
            <Database size={14} aria-hidden="true" /> Connection
          </label>
          <label className={`iw-radio${s.targetKind === 'file' ? ' on' : ''}`}>
            <input type="radio" name="tr-target" checked={s.targetKind === 'file'} onChange={() => patch({ targetKind: 'file' })} />
            <FileCode2 size={14} aria-hidden="true" /> SQL file
          </label>
        </div>

        {s.targetKind === 'connection' ? (
          <div className="iw-where">
            <Field label="Target connection">
              <select className="input" aria-label="Target connection" value={s.targetCid} onChange={(e) => t.setTargetConnection(e.target.value)}>
                {!s.targetCid && <option value="">Choose a connection…</option>}
                {t.connections.map((c) => <option key={c.id} value={c.id}>{c.name}{c.readOnly ? ' (read-only)' : ''}</option>)}
              </select>
            </Field>
            {t.target.databases && (
              <>
                <Crumb />
                <Field label="Database">
                  <select className="input" aria-label="Target database" value={s.targetDb ?? ''} onChange={(e) => patch({ targetDb: e.target.value || null, targetSchema: '' })}>
                    {!s.targetDb && <option value="">(connection default)</option>}
                    {s.targetDb && !t.target.databases.includes(s.targetDb) && <option value={s.targetDb}>{s.targetDb}</option>}
                    {t.target.databases.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </>
            )}
            <Crumb />
            <Field label={level} hint={`Type a new name to create it${t.target.defaultSchema ? `; empty = ${t.target.defaultSchema}` : ''}.`}>
              <input
                className="input"
                aria-label={`Target ${level.toLowerCase()}`}
                list="tr-target-schemas"
                value={s.targetSchema}
                placeholder={t.target.defaultSchema ?? '(default)'}
                spellCheck={false}
                disabled={!s.targetCid}
                onChange={(e) => patch({ targetSchema: e.target.value })}
              />
              <datalist id="tr-target-schemas">{t.target.schemaNames.map((n) => <option key={n} value={n} />)}</datalist>
            </Field>
          </div>
        ) : (
          <div className="iw-where">
            <Field label="Dialect">
              <select className="input" aria-label="Script dialect" value={s.dumpProvider} onChange={(e) => patch({ dumpProvider: e.target.value })}>
                {!s.dumpProvider && <option value="">Choose…</option>}
                {(t.dumpDialects ?? []).map((d) => <option key={d.provider} value={d.provider}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="File" className="tr-path" hint={pathIssue ?? (s.filePath.trim() ? undefined : 'The file is written when the transfer runs; an existing file is replaced.')}>
              <span className="tr-path-row">
                <input
                  className="input"
                  aria-label="Script file path"
                  value={s.filePath}
                  spellCheck={false}
                  placeholder="C:\backups\shop.sql"
                  onChange={(e) => patch({ filePath: e.target.value })}
                  onBlur={() => patch({ filePath: normalizeDumpPath(s.filePath) })}
                />
                {platform.hasFileSystem && (
                  <button type="button" className="btn" onClick={() => void browse()}><FolderOpen size={14} aria-hidden="true" /> Browse…</button>
                )}
              </span>
            </Field>
          </div>
        )}
      </div>

      {t.targetBlocker && <Callout tone="error">{t.targetBlocker}</Callout>}
      {t.dumpError && s.targetKind === 'file' && <Callout tone="error">{t.dumpError}</Callout>}
      {sameAsSource && <Callout tone="warn">The target is the source schema itself: give the tables new names in the next step, or the copy fails.</Callout>}
      {s.targetKind === 'file' && (
        <Callout tone="info">The script holds CREATE TABLE, INSERT, index and foreign key statements in the chosen dialect. Run it in a console of that database to restore.</Callout>
      )}
    </section>
  );
}
