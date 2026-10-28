# Persian term decisions (package A, maintained for the whole handbook)

Authoritative shared list for the `fa/` chapters. Rule: write «Persian (English)» on first use in a chapter, then the
Persian alone. Terms marked **keep EN** stay in Latin script everywhere (with Persian prose around them). Package H merges
this file into `fa/glossary.md` and deletes it. Anchors are the English glossary ids (`../glossary.md#anchor`).

| Anchor | English | Persian (use this) | Note |
|---|---|---|---|
| database | database | پایگاه داده | |
| dbms | DBMS | سامانه مدیریت پایگاه داده (DBMS) | after first use: DBMS |
| rdbms | RDBMS | سامانه مدیریت پایگاه داده رابطه‌ای (RDBMS) | |
| client-server | client/server | کلاینت/سرور | keep EN words `client`, `server` in prose: «کلاینت»، «سرور» |
| embedded-database | embedded database | پایگاه داده توکار (embedded) | SQLite is the example |
| driver | driver | درایور (driver) | |
| connection | connection | اتصال (connection) | never use «اتصال» for join |
| session | session | نشست (session) | |
| query | query | پرس‌وجو (query) | |
| result-set | result set | مجموعه نتیجه (result set) | |
| schema | schema | اسکیما (schema) | meaning 1 = structure, meaning 2 = namespace; always say which |
| instance | instance | نمونه (instance) / نمونه سرور | |
| system-catalog | system catalog | فهرست سیستمی (system catalog) | the tables that describe the tables |
| wire-protocol | wire protocol | پروتکل شبکه‌ای (wire protocol) | |
| dba | DBA | مدیر پایگاه داده (DBA) | |
| relation | relation | رابطه (relation) | |
| tuple | tuple | چندتایی (tuple) | |
| row | row | سطر (row) | |
| column | column | ستون (column) | |
| table | table | جدول (table) | |
| attribute | attribute | صفت (attribute) | |
| domain | domain | دامنه (domain) | |
| candidate-key | candidate key | کلید کاندید (candidate key) | |
| primary-key | primary key | کلید اصلی (primary key) | |
| foreign-key | foreign key | کلید خارجی (foreign key) | |
| composite-key | composite key | کلید مرکب (composite key) | |
| surrogate-key | surrogate key | کلید جانشین (surrogate key) | |
| natural-key | natural key | کلید طبیعی (natural key) | |
| null | NULL | مقدار تهی (NULL) | after first use: NULL |
| three-valued-logic | three-valued logic | منطق سه‌مقداری | TRUE, FALSE, UNKNOWN = درست، نادرست، نامعلوم |
| referential-integrity | referential integrity | تمامیت ارجاعی (referential integrity) | |
| cardinality-relationship | cardinality (relationship) | کاردینالیتی ارتباط (cardinality) | «یک‌به‌چند» (one-to-many), «چندبه‌چند» (many-to-many) |
| er-diagram | ER diagram | نمودار موجودیت-ارتباط (ER diagram) | |
| crows-foot | crow's foot | نمادگذاری پای کلاغی (crow's foot) | |
| relational-algebra | relational algebra | جبر رابطه‌ای | |
| selection | selection (σ) | گزینش (selection) | the σ operator; not SQL SELECT |
| projection | projection (π) | تصویر (projection) | |
| join | join | پیوند (join) | inner join = پیوند داخلی, left outer = پیوند خارجی چپ |
| cross-join | cross join | ضرب دکارتی (cross join) | |
| self-join | self join | پیوند خودی (self join) | |
| predicate | predicate | گزاره (predicate) | the condition in WHERE |
| aggregate | aggregate function | تابع تجمیعی (aggregate) | COUNT, SUM, AVG, MIN, MAX |
| group-by | GROUP BY | گروه‌بندی (GROUP BY) | |
| having | HAVING | HAVING | keep EN, explain as «شرط روی گروه‌ها» |
| distinct | DISTINCT | حذف تکراری‌ها (DISTINCT) | |
| alias | alias | نام مستعار (alias) | |
| literal | literal | مقدار لفظی (literal) | |
| expression | expression | عبارت (expression) | |
| order-by | ORDER BY | مرتب‌سازی (ORDER BY) | |
| limit-offset | LIMIT/OFFSET | LIMIT/OFFSET | keep EN; also TOP, FETCH |
| set-operation | set operation | عملگر مجموعه‌ای (UNION، INTERSECT، EXCEPT) | |
| ddl | DDL | DDL (زبان تعریف داده) | also DML, DQL, DCL, TCL: keep the abbreviations, Persian once |
| dml | DML | DML (زبان دستکاری داده) | |
| dql | DQL | DQL (زبان پرس‌وجو) | |
| dcl | DCL | DCL (زبان کنترل دسترسی) | |
| tcl | TCL | TCL (زبان کنترل تراکنش) | |
| subquery | subquery | زیرپرس‌وجو (subquery) | |
| correlated-subquery | correlated subquery | زیرپرس‌وجوی همبسته (correlated subquery) | |
| derived-table | derived table | جدول مشتق‌شده (derived table) | |
| cte | CTE | عبارت جدولی مشترک (CTE) | after first use: CTE |
| recursive-cte | recursive CTE | CTE بازگشتی | |
| window-function | window function | تابع پنجره‌ای (window function) | |
| window-partition | partition (window) | بخش‌بندی پنجره (PARTITION BY) | not the storage «پارتیشن» |
| frame | frame | قاب (frame) | ROWS / RANGE |
| pivot | PIVOT | محوری‌سازی (pivot) | |
| lateral | LATERAL | LATERAL | keep EN |
| apply | APPLY | APPLY | keep EN |
| merge | MERGE | MERGE | keep EN |
| upsert | upsert | upsert | keep EN: «درج یا به‌روزرسانی» once |
| temp-table | temporary table | جدول موقت (temporary table) | |
| table-variable | table variable | متغیر جدولی (table variable) | |
| stored-procedure | stored procedure | رویه ذخیره‌شده (stored procedure) | |
| function | function | تابع (function) | |
| package | package (Oracle) | پکیج (package) | |
| trigger | trigger | تریگر (trigger) | |
| view | view | نما (view) | |
| materialized-view | materialized view | نمای مادی‌شده (materialized view) | |
| sequence | sequence | سکوئنس (sequence) | |
| identity | identity column | ستون هویت (identity) | |
| synonym | synonym | مترادف (synonym) | |
| functional-dependency | functional dependency | وابستگی تابعی (functional dependency) | |
| normal-form | normal form | شکل نرمال (normal form) | 1NF … BCNF = «شکل نرمال اول» … «بویس-کاد» |
| normalisation | normalisation | نرمال‌سازی (normalisation) | |
| denormalisation | denormalisation | غیرنرمال‌سازی (denormalisation) | |
| anomaly | anomaly | ناهنجاری (anomaly) | insert/update/delete anomaly = ناهنجاری درج/به‌روزرسانی/حذف |
| constraint | constraint | قید (constraint) | |
| check-constraint | CHECK | قید CHECK | |
| default-value | DEFAULT | مقدار پیش‌فرض (DEFAULT) | |
| unique-constraint | UNIQUE | قید یکتایی (UNIQUE) | |
| cascade | cascade | آبشاری (cascade) | ON DELETE CASCADE = «حذف آبشاری» |
| data-type | data type | نوع داده (data type) | |
| precision-scale | precision / scale | دقت و مقیاس (precision / scale) | |
| collation | collation | ترتیب مرتب‌سازی و مقایسه (collation) | |
| time-zone | time zone | منطقه زمانی (time zone) | |
| uuid | UUID / GUID | UUID | keep EN |
| transaction | transaction | تراکنش (transaction) | owner I-09 |
| index | index | نمایه (index) | owner I-07 |
| engine | engine | موتور (engine) | |
| optimizer | optimizer | بهینه‌ساز (optimizer) | |
| lock | lock | قفل (lock) | |
| deadlock | deadlock | بن‌بست (deadlock) | |
| buffer-pool | buffer pool | استخر بافر (buffer pool) | |
| replication | replication | همانندسازی (replication) | |
| backup | backup | پشتیبان (backup) | |
| partitioning | partitioning (table) | پارتیشن‌بندی (partitioning) | |
| shard | shard | شارد (shard) | |
| cache | cache | حافظه نهان (cache) | |
| plan | execution plan | طرح اجرا (execution plan) | |
| orm | ORM | ORM | keep EN |
| bag | bag (multiset) | چندمجموعه (bag / multiset) | SQL tables are bags, relations are sets |
| closure | closure property | خاصیت بستار (closure) | |
| namespace | namespace | فضای نام (namespace) | |
| cluster | cluster (PostgreSQL) | کلاستر (cluster) | PostgreSQL meaning: one server instance and its data directory |
| keyspace | keyspace | keyspace | keep EN (Cassandra) |

Prose style reminders (see plan §4.6): Latin digits for code-related numbers; «» for quotes; Persian comma «،» and semicolon «؛»;
code, identifiers, SQL keywords, paths, commands are never translated; Mermaid labels stay English; wrap the body in
`<div dir="rtl">` and keep code fences and Mermaid blocks outside it.
