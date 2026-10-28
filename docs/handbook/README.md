# Rowlit handbook / راهنمای Rowlit

A bilingual database textbook and maintainer handbook. Start with Part I for database foundations and Part II for the Rowlit codebase.

کتاب دوزبانهٔ مبانی پایگاه داده و راهنمای نگهداری Rowlit. برای مبانی از بخش I و برای کد برنامه از بخش II آغاز کنید.

**Levels / سطح‌ها:** L1 beginner / مقدماتی · L2 practitioner / کاربردی · L3 senior / عمیق

## Part I — Database textbook / کتاب پایگاه داده

| # | EN | FA | Level |
|---:|---|---|---|
| 1 | [What a database is](en/part1/01-what-is-a-database.md) | [پایگاه داده چیست](fa/part1/01-what-is-a-database.md) | L1 beginner → L2 |
| 2 | [The relational model](en/part1/02-relational-model.md) | [مدل رابطه‌ای](fa/part1/02-relational-model.md) | L1 beginner → L2 |
| 3 | [SQL I: reading data](en/part1/03-sql-basics.md) | [SQL I: خواندن داده](fa/part1/03-sql-basics.md) | L1 beginner |
| 4 | [SQL II: advanced queries](en/part1/04-sql-advanced.md) | [SQL II: پرس‌وجوهای پیشرفته](fa/part1/04-sql-advanced.md) | L2 practitioner |
| 5 | [Data modelling and normalisation](en/part1/05-modelling-and-normalisation.md) | [مدل‌سازی داده و نرمال‌سازی](fa/part1/05-modelling-and-normalisation.md) | L2 practitioner |
| 6 | [Storage internals](en/part1/06-storage-internals.md) | [ساختار درونی ذخیره‌سازی](fa/part1/06-storage-internals.md) | L3 senior (starts at L1) |
| 7 | [Indexes in depth](en/part1/07-indexes.md) | [نمایه‌ها به‌تفصیل](fa/part1/07-indexes.md) | L3 senior (starts at L1) |
| 8 | [The query pipeline and the optimizer](en/part1/08-query-processing.md) | [خط لولهٔ پرس‌وجو و بهینه‌ساز](fa/part1/08-query-processing.md) | L3 senior (starts at L1) |
| 9 | [Transactions, ACID and isolation](en/part1/09-transactions-and-isolation.md) | [تراکنش‌ها، ACID و جداسازی](fa/part1/09-transactions-and-isolation.md) | L2 practitioner → L3 senior |
| 10 | [Concurrency: locks, latches, MVCC](en/part1/10-concurrency-locking-mvcc.md) | [هم‌روندی: قفل، latch و MVCC](fa/part1/10-concurrency-locking-mvcc.md) | L3 senior (sections 1–2 are L2) |
| 11 | [WAL, redo/undo, checkpoints, recovery](en/part1/11-logging-and-recovery.md) | [WAL، redo/undo، checkpoint و بازیابی](fa/part1/11-logging-and-recovery.md) | L3 senior (sections 1–2 are L2) |
| 12 | [Backup, PITR, replication, HA, partitioning, sharding](en/part1/12-backup-replication-ha.md) | [پشتیبان‌گیری، PITR، همانندسازی، دسترس‌پذیری بالا، پارتیشن‌بندی و شاردینگ](fa/part1/12-backup-replication-ha.md) | L2 practitioner → L3 senior |
| 13 | [Performance tuning methodology](en/part1/13-performance-tuning.md) | [روش تنظیم کارایی](fa/part1/13-performance-tuning.md) | L2 practitioner → L3 senior |
| 14 | [Database security](en/part1/14-security.md) | [۱۴. امنیت پایگاه داده](fa/part1/14-security.md) | L2 practitioner (L3 deep-dive blocks) |
| 15 | [OLTP vs OLAP and columnar engines](en/part1/15-oltp-vs-olap-columnar.md) | [۱۵. OLTP در برابر OLAP و موتورهای ستونی](fa/part1/15-oltp-vs-olap-columnar.md) | L2 practitioner → L3 senior |
| 16 | [NoSQL families and their internals](en/part1/16-nosql-families.md) | [۱۶. خانواده‌های NoSQL و درون آن‌ها](fa/part1/16-nosql-families.md) | L2 practitioner → L3 senior |
| 17 | [The eight relational dialects compared](en/part1/17-dialect-comparison.md) | [۱۷. مقایسهٔ هشت گویش رابطه‌ای](fa/part1/17-dialect-comparison.md) | L2 practitioner |
| 18 | [Answer key and lab setup](en/part1/18-exercise-answers.md) | [پاسخ تمرین‌ها و راه‌اندازی آزمایشگاه](fa/part1/18-exercise-answers.md) | L1 beginner |

## Part II — Rowlit internals / درون Rowlit

| # | EN | FA | Level |
|---:|---|---|---|
| 1 | [What a database IDE is, and what Rowlit is](en/part2/01-what-is-a-database-ide.md) | [IDE پایگاه داده چیست و Rowlit چیست](fa/part2/01-what-is-a-database-ide.md) | L1 beginner |
| 2 | [A tour of the app](en/part2/02-tour-of-the-app.md) | [گردش در برنامه](fa/part2/02-tour-of-the-app.md) | L1 beginner |
| 3 | [Big-picture architecture](en/part2/03-big-picture-architecture.md) | [معماری کلان](fa/part2/03-big-picture-architecture.md) | L1 beginner → L3 senior |
| 4 | [Running Rowlit from source](en/part2/04-development-setup.md) | [اجرای Rowlit از منبع](fa/part2/04-development-setup.md) | L1 beginner |
| 5 | [The engine host: startup, REST API, errors](en/part2/05-engine-host-and-api.md) | [میزبان موتور: راه‌اندازی، REST API، خطاها](fa/part2/05-engine-host-and-api.md) | L2 practitioner → L3 senior |
| 6 | [The WebSocket event protocol](en/part2/06-websocket-protocol.md) | [پروتکل رویداد WebSocket](fa/part2/06-websocket-protocol.md) | L2 practitioner → L3 senior |
| 7 | [Engine modules, DI and keyed features](en/part2/07-engine-modules-and-di.md) | [ماژول‌های موتور، DI و قابلیت‌های کلیددار](fa/part2/07-engine-modules-and-di.md) | L3 senior |
| 8 | [Connections, sessions and executing SQL](en/part2/08-connections-sessions-execution.md) | [اتصال‌ها، نشست‌ها و اجرای SQL](fa/part2/08-connections-sessions-execution.md) | L2 practitioner → L3 senior |
| 9 | [Relational providers one by one](en/part2/09-relational-providers.md) | [فراهم‌کننده‌های رابطه‌ای، یکی‌یکی](fa/part2/09-relational-providers.md) | L3 senior |
| 10 | [Catalog, metadata cache and the explorer](en/part2/10-catalog-and-metadata.md) | [کاتالوگ، حافظه نهان فراداده و اکسپلورر](fa/part2/10-catalog-and-metadata.md) | L2 practitioner → L3 senior |
| 11 | [IntelliSense (sql-intel)](en/part2/11-intellisense.md) | [IntelliSense (sql-intel)](fa/part2/11-intellisense.md) | L3 senior (sections 1-2 readable from L2) |
| 12 | [The editor, formatter, snippets and local history](en/part2/12-editor-and-formatter.md) | [ویرایشگر، قالب‌بند، snippetها و تاریخچه محلی](fa/part2/12-editor-and-formatter.md) | L2 practitioner → L3 senior |
| 13 | [The results grid, charts and data editing](en/part2/13-results-grid-and-data-editing.md) | [گرید نتایج، نمودارها و ویرایش داده](fa/part2/13-results-grid-and-data-editing.md) | L2 practitioner → L3 senior |
| 14 | [Designers, DDL and object editing](en/part2/14-designers-and-ddl.md) | [طراح‌ها، DDL و ویرایش شیء](fa/part2/14-designers-and-ddl.md) | L2 practitioner → L3 senior |
| 15 | [Import, export, execution plans and ER diagrams](en/part2/15-import-export-plans-er.md) | [درون‌ریزی، برون‌ریزی، طرح اجرا و نمودار ER](fa/part2/15-import-export-plans-er.md) | L2 practitioner |
| 16 | [Linked databases and federation (DuckDB)](en/part2/16-linked-databases-federation.md) | [پایگاه‌های داده‌ی پیوندی و فدراسیون (DuckDB)](fa/part2/16-linked-databases-federation.md) | L3 senior (sections 1 and 2.1-2.4 are readable at L2) |
| 17 | [Sources I: Redis and MongoDB](en/part2/17-sources-redis-mongo.md) | [منابع I: Redis و MongoDB](fa/part2/17-sources-redis-mongo.md) | L2 practitioner → L3 senior |
| 18 | [Sources II: Kafka and Elasticsearch](en/part2/18-sources-kafka-elasticsearch.md) | [منبع‌ها ۲: Kafka و Elasticsearch](fa/part2/18-sources-kafka-elasticsearch.md) | L2 practitioner → L3 senior |
| 19 | [Security model and secrets](en/part2/19-security-and-secrets.md) | [مدل امنیت و secretها](fa/part2/19-security-and-secrets.md) | L2 practitioner → L3 senior |
| 20 | [UI architecture: React, Zustand, commands and the platform](en/part2/20-ui-architecture.md) | [معماری رابط کاربری: React، Zustand، فرمان‌ها و پلتفرم](fa/part2/20-ui-architecture.md) | L2 practitioner → L3 senior |
| 21 | [Logs and activity, resources and memory](en/part2/21-logs-activity-resources.md) | [log، activity، منابع و حافظه](fa/part2/21-logs-activity-resources.md) | L2 practitioner → L3 senior |
| 22 | [The Electron shell: lifecycle, IPC, windows and updates](en/part2/22-desktop-shell.md) | [پوستهٔ Electron: چرخهٔ عمر، IPC، window و update](fa/part2/22-desktop-shell.md) | L2 practitioner → L3 senior |
| 23 | [Testing and QA](en/part2/23-testing-and-qa.md) | [آزمون و تضمین کیفیت](fa/part2/23-testing-and-qa.md) | L2 practitioner |
| 24 | [Build, CI, release and contributing](en/part2/24-build-ci-release-contributing.md) | [ساخت، CI، انتشار و مشارکت](fa/part2/24-build-ci-release-contributing.md) | L2 practitioner |

## Reference / مرجع

- [English glossary](en/glossary.md)
- [واژه‌نامهٔ فارسی](fa/glossary.md)
- [How to read — English](en/00-how-to-read.md) · [روش مطالعه — فارسی](fa/00-how-to-read.md)
