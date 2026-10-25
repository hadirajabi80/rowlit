import { DEFAULT_RESOURCES, useSettings, type FullSettings } from '../../../../store/settings';
import { Card, Num, Row, ToggleRow } from '../controls';

export function ConnectionsSection() {
  const s = useSettings((x) => x.settings) as FullSettings;
  const up = useSettings.getState().update;
  // Resources (docs/resources.md): engine settings `resources.*` (an older engine may not send them yet).
  const r = { ...DEFAULT_RESOURCES, ...s.resources };
  const res = (patch: Partial<typeof r>) => up({ resources: patch });
  return (
    <>
      <Card title="Sessions" description="Each console, data tab and object tab uses a session on its connection.">
        <Row label="Sessions per connection" htmlFor="set-sess" hint="The engine refuses more (SESSION_LIMIT)" keywords="session limit pool connection">
          <Num id="set-sess" value={s.connections.maxSessionsPerProfile} min={1} max={64} onChange={(v) => up({ connections: { maxSessionsPerProfile: v } })} />
        </Row>
      </Card>
      <Card
        title="Resources"
        description="Idle connections and cached data are released automatically; a tab reconnects on its next run. Sessions with an open transaction, a running query or temporary tables are never released."
      >
        <ToggleRow
          id="set-res-auto" label="Release resources automatically" checked={r.autoRelease} onChange={(v) => res({ autoRelease: v })}
          hint="Idle sessions, the open connections limit and background results" keywords="memory idle auto close release"
        />
        <Row label="Close idle sessions after (minutes)" htmlFor="set-res-idle" hint="0 = never" keywords="idle timeout session reaper disconnect">
          <Num id="set-res-idle" value={r.idleSessionMinutes} min={0} max={1440} onChange={(v) => res({ idleSessionMinutes: v })} />
        </Row>
        <Row label="Open connections at most" htmlFor="set-res-max" hint="Opening one more closes the least recently used idle one · 0 = unlimited" keywords="max connections limit lru">
          <Num id="set-res-max" value={r.maxOpenConnections} min={0} max={1000} onChange={(v) => res({ maxOpenConnections: v })} />
        </Row>
        <Row label="Memory limit (MB)" htmlFor="set-res-mem" hint="Engine and windows together · 0 = automatic (25% of RAM)" keywords="memory ram limit pressure">
          <Num id="set-res-mem" value={r.memoryLimitMb} min={0} max={1_048_576} onChange={(v) => res({ memoryLimitMb: v })} />
        </Row>
        <ToggleRow
          id="set-res-pressure" label="Free memory faster near the limit" checked={r.trimUnderPressure} onChange={(v) => res({ trimUnderPressure: v })}
          hint="Shorter timeouts and smaller caches while memory use is high" keywords="memory pressure trim"
        />
        <Row label="Release background results after (minutes)" htmlFor="set-res-results" hint="Rows beyond the first page of tabs not viewed for this long · 0 = never" keywords="results rows memory background tabs">
          <Num id="set-res-results" value={r.releaseResultsMinutes} min={0} max={1440} onChange={(v) => res({ releaseResultsMinutes: v })} />
        </Row>
        <Row label="Result rows kept across tabs" htmlFor="set-res-rows" hint="Beyond this, background results are released first" keywords="results rows budget memory">
          <Num id="set-res-rows" value={r.resultRowBudget} min={10_000} max={100_000_000} onChange={(v) => res({ resultRowBudget: v })} />
        </Row>
        <Row label="Metadata cache (MB)" htmlFor="set-res-cat" hint="Catalogs of databases not shown are evicted beyond it" keywords="catalog cache metadata memory">
          <Num id="set-res-cat" value={r.catalogCacheMb} min={8} max={16_384} onChange={(v) => res({ catalogCacheMb: v })} />
        </Row>
        <Row label="Engine result cache (MB)" htmlFor="set-res-rc" hint="Rows kept for paging and export of loaded rows" keywords="results cache engine memory export">
          <Num id="set-res-rc" value={r.resultCacheMb} min={16} max={65_536} onChange={(v) => res({ resultCacheMb: v })} />
        </Row>
      </Card>
    </>
  );
}
