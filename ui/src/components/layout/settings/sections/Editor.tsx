import { shortcutLabelOf } from '../../../../commands/registry';
import { LOCAL_HISTORY_DAYS_KEY, LOCAL_HISTORY_KEY, localHistoryEnabled, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, retentionDays } from '../../../LocalHistory/settings';
import { openRoutinesInEditMode, OPEN_ROUTINES_IN_EDIT_KEY, useSettings, type FullSettings } from '../../../../store/settings';
import { Card, Num, Row, Select, ToggleRow } from '../controls';

export function EditorSection() {
  const s = useSettings((x) => x.settings) as FullSettings;
  const up = useSettings.getState().update;
  return (
    <>
      <Card title="Editing">
        <Row label="Tab size" htmlFor="set-tab" hint="Spaces per indent level" keywords="indent tabs">
          <Num id="set-tab" value={s.editor.tabSize} min={1} max={8} onChange={(v) => up({ editor: { tabSize: v } })} />
        </Row>
      </Card>
      <Card title="IntelliSense" description="How completions are written into your SQL.">
        <Row label="Completion keyword case" htmlFor="set-kw" keywords="uppercase lowercase autocomplete suggest">
          <Select id="set-kw" value={s.editor.keywordCase} options={[['upper', 'UPPER'], ['lower', 'lower'], ['asIs', 'As typed']]} onChange={(v) => up({ editor: { keywordCase: v } })} />
        </Row>
        <Row label="Qualify objects" htmlFor="set-qo" hint="Prefix inserted tables with their schema" keywords="schema prefix autocomplete">
          <Select id="set-qo" value={s.editor.qualifyObjects} options={[['never', 'Never'], ['nonDefaultSchema', 'Outside the default schema'], ['always', 'Always']]} onChange={(v) => up({ editor: { qualifyObjects: v } })} />
        </Row>
      </Card>
      <Card title="Running statements">
        <ToggleRow
          id="set-blank"
          label="A blank line ends a statement"
          hint={`${shortcutLabelOf('run.statement') ?? 'Run statement'} runs the paragraph under the cursor`}
          keywords="run execute statement split paragraph"
          checked={s.editor.blankLineSplitsStatements}
          onChange={(v) => up({ editor: { blankLineSplitsStatements: v } })}
        />
      </Card>
      <Card title="Local history" description="A private timeline of each editor's text, so a lost or overwritten query can be brought back.">
        <ToggleRow
          id="set-local-history"
          label="Keep local history"
          hint={`Snapshots on run, save, close and every 2 minutes while typing; open them with ${shortcutLabelOf('editor.localHistory') ?? 'Local history'}`}
          keywords="local history versions snapshots restore revisions"
          checked={localHistoryEnabled(s)}
          onChange={(v) => up({ ui: { [LOCAL_HISTORY_KEY]: v } })}
        />
        <Row label="Keep snapshots for (days)" htmlFor="set-local-history-days" hint="Older snapshots are deleted; a labelled snapshot is kept" keywords="local history retention days expire">
          <Num id="set-local-history-days" value={retentionDays(s)} min={MIN_RETENTION_DAYS} max={MAX_RETENTION_DAYS} onChange={(v) => up({ ui: { [LOCAL_HISTORY_DAYS_KEY]: v } })} />
        </Row>
      </Card>
      <Card title="Routines">
        <ToggleRow
          id="set-routine-edit"
          label="Open procedures and functions in edit mode"
          hint={`Double-click, Enter and ${shortcutLabelOf('view.goToObject') ?? 'Go to object'} open them editable; ${shortcutLabelOf('file.save') ?? 'Save'} saves to the database`}
          keywords="routine procedure function alter edit"
          checked={openRoutinesInEditMode(s)}
          onChange={(v) => up({ ui: { [OPEN_ROUTINES_IN_EDIT_KEY]: v } })}
        />
      </Card>
    </>
  );
}
