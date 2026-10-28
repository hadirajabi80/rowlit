# Shared diagrams (package E)

Reusable Mermaid blocks owned by package E. Copy a block into your chapter and cite its source figure; labels stay in English in both languages. Code read at 08528ae.

<a id="e-three-processes"></a>
## Three processes of Rowlit (II-03 figure 3.1)

```mermaid
flowchart LR
  subgraph Main["Electron main process (desktop/)"]
    SUP["EngineSupervisor<br/>engine-process.ts"]
    PROTO["dbstudio:// protocol<br/>protocol.ts"]
    IPC["IPC handlers<br/>ipc.ts"]
  end
  subgraph Renderer["Renderer process (ui/)"]
    UI["React components"]
    ST["Zustand stores"]
    INTEL["intel / format / commands"]
    API["api/client.ts + api/ws.ts"]
  end
  subgraph Engine[".NET engine sidecar (engine/)"]
    HOST["DbStudio.Host<br/>minimal API + WsHub"]
    CORE["DbStudio.Core<br/>sessions, execution, catalog"]
    PROV["Providers and sources<br/>one project per family"]
  end
  DB[("Database servers<br/>and files")]
  SUP -- "spawn, --parent-pid,<br/>read DBSTUDIO_READY" --> HOST
  PROTO -- "serves ui/dist" --> UI
  UI -- "window.dbstudio (preload)" --> IPC
  API -- "REST /api/v1 + Bearer" --> HOST
  HOST -- "WebSocket events" --> API
  HOST --> CORE --> PROV
  PROV -- "ADO.NET and native drivers" --> DB
```

<a id="e-engine-projects"></a>
## Engine project references (II-03 figure 3.4)

```mermaid
flowchart TD
  HOST["DbStudio.Host<br/>(DbStudio.Engine.dll)"]
  FED["DbStudio.Federation"]
  IMP["DbStudio.Import"]
  subgraph Rel["Relational providers"]
    SS["SqlServer"]
    OR["Oracle"]
    PG["PostgreSql"]
    SL["Sqlite"]
    MY["MySql"]
    CH["ClickHouse"]
    SF["Snowflake"]
    CS["Cassandra"]
  end
  subgraph Src["Sources"]
    RE["Redis"]
    MO["Mongo"]
    KA["Kafka"]
    ES["Elasticsearch"]
  end
  LOGS["DbStudio.Logs"]
  CORE["DbStudio.Core"]
  HOST --> FED
  HOST --> IMP
  HOST --> Rel
  HOST --> Src
  HOST --> LOGS
  FED --> IMP
  FED --> Rel
  FED --> MO
  FED --> ES
  IMP --> Rel
  MY --> LOGS
  CH --> LOGS
  SF --> LOGS
  CS --> LOGS
  ES --> LOGS
  LOGS --> CORE
  Rel --> CORE
  Src --> CORE
  IMP --> CORE
  FED --> CORE
  HOST --> CORE
```

<a id="e-core-services"></a>
## Core services and dependencies (II-05 figure 5.2)

```mermaid
classDiagram
  class ConnectionStore {
    +Get(id)
    +WithSecrets(profile)
    +ResolveForOpenAsync(profile)
  }
  class SessionManager {
    +CreateAsync(...)
    +Get(sid)
    +PublishChanged(h)
  }
  class ExecutionService {
    +Start(sid, cmd)
    +Cancel(sid)
  }
  class CatalogService {
    +GetSnapshotAsync(...)
    +InvalidateAfterDdl(...)
  }
  class ResourceManager {
    +RunPolicyAsync()
    +Snapshot(clientId)
  }
  class WsHub {
    +Publish(ev)
    +HandleAsync(ctx)
  }
  class IEventPublisher {
    <<interface>>
    +Publish(ev)
  }
  class ISecretStore {
    <<interface>>
  }
  class ITunnelResolver {
    <<interface>>
  }
  WsHub ..|> IEventPublisher
  ConnectionStore --> ISecretStore
  ConnectionStore --> ITunnelResolver
  SessionManager --> ConnectionStore
  SessionManager --> IEventPublisher
  ExecutionService --> SessionManager
  ExecutionService --> CatalogService
  ExecutionService --> IEventPublisher
  CatalogService --> ConnectionStore
  ResourceManager --> SessionManager
  ResourceManager --> CatalogService
```

<a id="e-registries"></a>
## Registries and keyed features (II-07 figure 7.2)

```mermaid
classDiagram
  class ProviderRegistry {
    +All
    +Get(providerId) IDbProvider
    +Find(providerId)
    +ForDialect(dialect)
  }
  class SourceRegistry {
    +DisplayOrder$
    +All
    +Get(providerId) IDataSourceProvider
    +KindOf(providerId)
    +DialectOf(providerId)
    +Describe()
  }
  class RelationalSourceAdapter {
    +Provider IDbProvider
    +OpenAsync() throws
  }
  class ProviderFeatures {
    +FromServices(sp)$
    +Scripter(id) IDdlScripter
    +Database(id) IDesignerDatabase
    +PlanReader(id) IPlanReader
    +Binder(id) IParamBinder
    +ObjectBrowser(provider)$
  }
  class IDbProvider {
    <<interface>>
  }
  class IDataSourceProvider {
    <<interface>>
  }
  SourceRegistry --> ProviderRegistry
  SourceRegistry --> IDataSourceProvider
  RelationalSourceAdapter ..|> IDataSourceProvider
  RelationalSourceAdapter --> IDbProvider
  ProviderRegistry --> IDbProvider
```

<a id="e-session-contract"></a>
## Session contract and handle (II-08 figure 8.1)

```mermaid
classDiagram
    class IDbSession {
        <<interface>>
        +SessionState State
        +TransactionMode TxMode
        +bool TxOpen
        +string CurrentDatabase
        +SchemaMode SchemaMode
        +ExecuteAsync(request, sink, ct) ExecutionSummary
        +Cancel()
        +CommitAsync(ct)
        +RollbackAsync(ct)
        +SetTransactionModeAsync(mode, ct)
        +ChangeDatabaseAsync(db, ct)
        +PingAsync(ct) bool
        +FindUnboundParameter(batches, params) ErrorInfo
    }
    class IExecutionSink {
        <<interface>>
        +BatchStarted(i)
        +ResultSetStarted(id, i, columns)
        +Rows(id, rows)
        +ResultSetEnded(id, count, truncated, ms)
        +RowsAffected(i, count, kind)
        +Message(i, severity, text, line, code, source)
        +Error(i, error)
        +BatchEnded(i, ms, status)
    }
    class AdoSessionBase {
        <<abstract>>
        #RowBatchSize 200
        #RequiresTransaction(ctx) bool
        #MapException(ex, batch) ErrorInfo
        #CancelCommand(cmd)
        +RunExclusiveAsync(work, ct)
        +DescribeAsync(sql, params, ct)
    }
    class SessionHandle {
        +string Id
        +ConnectionProfile Profile
        +IDbSession Session
        +bool Released
        +string ReleasedReason
        +bool HasTempObjects
        +string OwnerClientId
        +TryReserve(operationId) bool
        +Release()
    }
    class EventExecutionSink
    IDbSession <|.. AdoSessionBase
    IExecutionSink <|.. EventExecutionSink
    SessionHandle --> IDbSession : wraps
    AdoSessionBase ..> IExecutionSink : reports to
```

<a id="e-provider-contract"></a>
## Relational provider contract (II-09 figure 9.1)

```mermaid
classDiagram
  class IDbProvider {
    <<interface>>
    +Id string
    +Dialect Dialect
    +FormSpec ConnectionFormSpec
    +BuildConnectionString(profile, password)
    +TestAsync(profile, password, ct)
    +OpenSessionAsync(profile, password, options, ct) IDbSession
    +OpenCatalogReaderAsync(profile, password, ct) ICatalogReader
    +DdlGenerator IDdlGenerator
    +Diagnostics ISqlDiagnostics
    +Identifiers IdentifierRules
    +ClearPooledConnections(profile, password, dbs)
  }
  class IDbSession {
    <<interface>>
    +State SessionState
    +TxMode TransactionMode
    +TxOpen bool
    +CurrentDatabase string
    +ExecuteAsync(request, sink, ct) ExecutionSummary
    +Cancel()
    +SetTransactionModeAsync(mode, ct)
    +CommitAsync(ct)
    +RollbackAsync(ct)
    +ChangeDatabaseAsync(db, ct)
    +PingAsync(ct)
  }
  class ICatalogReader {
    <<interface>>
    +ListSchemasAsync(db, ct)
    +LoadSchemaAsync(db, schema, ct) SchemaCatalog
    +GetObjectDetailsAsync(obj, ct)
    +GetDdlAsync(obj, ct)
  }
  class IExecutionSink {
    <<interface>>
    +ResultSetStarted(id, batch, columns)
    +Rows(id, rows)
    +Message(...)
    +Error(batch, error)
  }
  class AdoSessionBase {
    <<abstract>>
    #ValidateBatch()
    #ConfigureCommand()
    #ExecuteReaderAsync()
    #ReadValue()
    #MapException()
    #CancelCommand()
  }
  IDbProvider ..> IDbSession : opens
  IDbProvider ..> ICatalogReader : opens
  IDbSession ..> IExecutionSink : reports to
  AdoSessionBase ..|> IDbSession
```

<a id="e-ado-loop"></a>
## AdoSessionBase execution loop (II-09 figure 9.2)

```mermaid
flowchart TD
  A["ExecuteAsync<br/>CAS Idle to Executing"] -->|"not idle"| X1(["SessionBusy / SessionBroken /<br/>ObjectDisposed"])
  A --> B["Task.Run(RunExecutionAsync)"]
  B --> C["OnExecutionStartingAsync (hook)"]
  C --> D{"next batch?"}
  D -->|no| Z["OnExecutionCompletedAsync (hook)<br/>state back to Idle or Broken"]
  D -->|yes| E["ValidateBatch (hook)"]
  E -->|"rejected"| ERR["sink.Error"]
  E --> F["manual mode and RequiresTransaction:<br/>BeginTransactionAsync (hook)"]
  F --> G["CreateCommand, ConfigureCommand (hook),<br/>BindParameters"]
  G --> H["ExecuteReaderAsync (hook)"]
  H --> I["per result set: DescribeColumns, ReadValue (hooks)<br/>RowBuffer 200 rows / 256 KB / 50 ms"]
  I -->|"MaxRows hit"| T["OnResultSetTruncatedAsync (hook):<br/>drain or cancel"]
  I --> J["ReportRowsAffectedAsync (hook)"]
  H -->|"exception"| K["MapException (hook) or cancelled"]
  J --> L["OnBatchCompletedAsync (hook), auto-commit if<br/>AutoCommitAfterBatch, QueryServerTransactionOpenAsync"]
  K --> L
  ERR --> L
  T --> J
  L -->|"StopOnError and error"| Z
  L --> D
```
