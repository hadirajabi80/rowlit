<div dir="rtl" markdown="1">

# ۱۷. مقایسهٔ هشت گویش رابطه‌ای

> **سطح:** L2 کاربر حرفه‌ای | **بخش:** I | **کد Rowlit در نسخهٔ** `08528ae` **بررسی شده است**
>
> **در یک جمله:** هر موتور رابطه‌ای «SQL» صحبت می‌کند، اما هرکدام گویش خودش را دارد؛ پس یک ایده (نقل‌قول کردن نام، گرفتن ۱۰ سطر اول، پاس دادن پارامتر، پیدا کردن ستون‌های یک جدول) به هشت شکل نوشته می‌شود.
>
> **یاد می‌گیرید:**
>
> - چرا گویش‌ها هستند و کدام تفاوت‌ها ظاهری‌اند، کدام معنا را عوض می‌کنند و کدام نبود قابلیت واقعی‌اند
> - نقل‌قول شناسه، تبدیل حروف (case folding) و سلسله‌مراتب نام در SQL Server، Oracle، PostgreSQL، MySQL/MariaDB، SQLite، ClickHouse، Snowflake و Cassandra
> - لیترال‌ها، کامنت‌ها، NULL، محدود کردن سطر، تاریخ، رشته، نوع و کلید خودکار در کنار هم
> - جانگهدارها، جداکننده‌های دسته (`GO`، `/`، `DELIMITER`) و زبان‌های رویه‌ای
> - فراداده هر موتور کجاست، تراکنش و DDL چگونه رفتار می‌کنند و طرح اجرا را چطور بگیریم
> - ترجمهٔ یک پرس‌وجوی واقعی به هر هشت موتور
>
> **پیش‌نیاز:** [فصل ۳ SQL I](03-sql-basics.md)، [فصل ۴ SQL II](04-sql-advanced.md)، [فصل ۹ تراکنش‌ها](09-transactions-and-isolation.md)
>
> **نسخهٔ انگلیسی:** [English](../../en/part1/17-dialect-comparison.md) | **قبلی:** [۱۶ خانواده‌های NoSQL](16-nosql-families.md) | **بعدی:** [۱۸ کلید پاسخ‌ها و راه‌اندازی آزمایشگاه](18-exercise-answers.md)
>
> برچسب‌های نمودارها به انگلیسی نگه داشته شده‌اند تا در GitHub درست نمایش داده شوند. (این فصل نمودار ندارد.)

> **دربارهٔ مثال‌ها.** پرس‌وجوها از دادهٔ اولیهٔ `shop` در آزمایشگاه Docker استفاده می‌کنند (`engine/tests/docker/seed-*.sql`؛ طرح SQLite از fixture انطباق `engine/tests/DbStudio.Providers.Conformance/ShopSchema.cs` می‌آید). هنگام نوشتن این فصل موتور Docker روشن نبود، پس هیچ خروجی از سرور گرفته نشده است. هرجا نتیجه‌ای آمده با دست از دادهٔ اولیه محاسبه شده و *محاسبه‌شده از دادهٔ اولیه (computed from the seed)* نام دارد؛ بقیهٔ خروجی‌ها *نمونه (illustrative)* اند. مثال‌های Snowflake فقط بر پایهٔ مستندات‌اند.

## ۱. ایده (مبتدی)

SQL یک استاندارد است (ISO/IEC 9075) که دهه‌ها رشد کرده: هستهٔ `SELECT … FROM … WHERE` همه‌جا یکی است و برای همین این کتاب توانست آن را یک بار در [فصل ۳](03-sql-basics.md) درس بدهد. اما هر فروشنده پیش از رسیدن استاندارد کاربرانی داشت که باید سرویس می‌داد، پس هر موتور نحو خودش را اضافه کرد و قاعده‌های استاندارد را هم به شیوهٔ خود پیاده کرد. نتیجه خانواده‌ای از **[گویش (dialect)](../glossary.md#dialect)**ها است.

زبان‌هایی را در نظر بگیرید که الفبای مشترک دارند. بیشتر واژه‌ها فقط در املا فرق دارند (`LIMIT 10` یا `TOP 10`). بعضی واژه‌ها یکسان به نظر می‌رسند اما معنای دیگری دارند (در Oracle رشتهٔ خالی `NULL` است؛ در PostgreSQL نه). و بعضی مفهوم‌ها اصلاً ترجمه ندارند (ClickHouse تراکنش چنددستوری ندارد؛ SQLite کاربر ندارد). برنامه‌نویس SQL خوب سه نوع تفاوت را جدا نگه می‌دارد:

1. **املا (spelling).** معنا یکی، نحو فرق دارد. ترجمهٔ مکانیکی.
2. **معناشناسی (semantics).** نحو یکی، رفتار فرق دارد (تبدیل حروف، ترتیب NULL، تقسیم صحیح، تبدیل ضمنی). نوع خطرناک: پرس‌وجو اجرا می‌شود و چیزی ظاهراً موجه اما متفاوت برمی‌گرداند.
3. **قابلیت (capability).** موتور نمی‌تواند (یا بسیار متفاوت انجام می‌دهد). طراحی را عوض می‌کنید، نه املا را.

این فصل مرجعی با روش است: برای هر موضوع یک جدول، همان مثال‌های `shop` در سراسر فصل و در پایان یک ترجمهٔ کامل. هشت موتور عبارت‌اند از SQL Server، Oracle، PostgreSQL، MySQL (همراه MariaDB)، SQLite، ClickHouse، Snowflake و Cassandra ([CQL](../glossary.md#cql)، زبان پرس‌وجوی Cassandra، که شبیه SQL است اما رابطه‌ای نیست).

**گویش در یک ابزار کجا زندگی می‌کند.** کلاینت پایگاه داده باید این قاعده‌ها را بداند، چون باید متن شما را به توکن بشکند، به دستور تقسیم کند، نام‌هایی را که تولید می‌کند نقل‌قول کند، پارامتر را پیوند دهد و نتیجه را صفحه‌بندی کند. Rowlit آن‌ها را در چند جا کد کرده که این فصل به آن‌ها اشاره می‌کند: کلاس ایستای `DialectInfo` (`engine/src/DbStudio.Core/Models/DialectInfo.cs`)، یک `IdentifierRules` برای هر provider، یک پیوندگر پارامتر برای هر provider و تقسیم‌کننده‌های دستور در `ui/src/intel/split/`. [فصل ۹ بخش II](../part2/09-relational-providers.md) آن‌ها را یکجا شرح می‌دهد.

## ۲. چگونه کار می‌کند (کاربر حرفه‌ای)

### ۲٫۱ هشت موتور در یک نگاه

| موتور | نسخه در آزمایشگاه | توکن گویش در Rowlit | زبان رویه‌ای | درگاه پیش‌فرض | سلسله‌مراتب داده |
|---|---|---|---|---|---|
| SQL Server | 2022 | `tsql` | [T-SQL](../glossary.md#t-sql) | 1433 | سرور ← پایگاه ← schema ← شیء |
| Oracle | 23 Free | `plsql` | [PL/SQL](../glossary.md#pl-sql) | 1521 | پایگاه (سرویس) ← schema (= کاربر) ← شیء |
| PostgreSQL | 17 | `pgsql` | [PL/pgSQL](../glossary.md#pl-pgsql) (و دیگران) | 5432 | خوشه ← پایگاه ← schema ← شیء |
| MySQL / MariaDB | 8.4 / 11 | `mysql` | برنامه‌های ذخیره‌شده (`BEGIN…END`) | 3306 | سرور ← پایگاه (= schema) ← شیء |
| SQLite | 3.4x | `sqlite` | ندارد (فقط trigger) | ندارد (فایل) | فایل ← schema (`main`، `temp`، پیوست‌شده) ← شیء |
| ClickHouse | 24+ | `clickhouse` | ندارد (تابع SQL تعریف‌شده توسط کاربر) | 8123 HTTP، 8443 HTTPS | سرور ← پایگاه ← جدول |
| Snowflake | جاری | `snowflake` | Snowflake Scripting (و JavaScript، Python، …) | 443 HTTPS | حساب ← پایگاه ← schema ← شیء |
| Cassandra | 4 / 5 | `cql` | ندارد (تابع تعریف‌شده توسط کاربر) | 9042 | خوشه ← [keyspace](../glossary.md#keyspace) ← جدول |

توکن‌های گویش مقدارهای `enum Dialect { TSql, PlSql, Sqlite, PgSql, MySql, ClickHouse, Snowflake, Cql, DuckDb }` هستند که روی سیم با حروف کوچک نوشته می‌شوند (`engine/src/DbStudio.Core/Models/CoreModels.cs:14`). `DuckDb` ([DuckDB SQL](../glossary.md#duckdb-sql)) یکی از هشت نیست: Rowlit آن را داخلی به‌عنوان موتور پایگاه‌های پیوندی به کار می‌برد ([فصل ۱۶ بخش II](../part2/16-linked-databases-federation.md))؛ تجزیه‌گرش مال PostgreSQL است و برای همین `DialectInfo` آن را برای کامنت و رشتهٔ `$$` کنار PostgreSQL می‌گذارد (`DialectInfo.cs:35-48`). درگاه‌ها پیش‌فرض فرم‌های اتصال Rowlit هستند (جانگهدار SQL Server یعنی `host,1433`، Oracle `DefaultPort = 1521`، PostgreSQL `5432`، MySQL `3306`، ClickHouse `8123`/`8443`، Cassandra `9042`).

ستون سلسله‌مراتب مهم‌تر از آنچه به نظر می‌رسد است. `DialectInfo.HasDatabases` برای SQL Server، PostgreSQL و Snowflake درست است: اتصال می‌تواند بین چند پایگاه جابه‌جا شود. `DialectInfo.SchemaIsDatabase` برای Oracle، MySQL/MariaDB، ClickHouse و Cassandra درست است: زیر سرور فقط یک سطح هست، پس Rowlit به‌جای schema، پایگاه‌ها (یا keyspaceها، یا کاربران Oracle) را فهرست می‌کند (`DialectInfo.cs:10-17`). وقتی سرور schema جاری را گزارش نکند، Rowlit به `dbo` (SQL Server)، `public` (PostgreSQL)، `main` (SQLite)، `default` (ClickHouse) و `PUBLIC` (Snowflake) برمی‌گردد (`DialectInfo.cs:20-33`).

### ۲٫۲ نام‌ها: نقل‌قول، تبدیل حروف و جست‌وجوی شیء

نامی مثل `Order Date` (با فاصله) یا `order` (کلمهٔ رزروشده) باید **[نقل‌قول (quote)](../glossary.md#quoting)** شود. نویسه‌ها فرق می‌کنند:

| موتور | نویسه‌های نقل‌قول | قاعدهٔ دوبرابر کردن نویسهٔ بستن | پذیرفته‌شده هم |
|---|---|---|---|
| SQL Server | `[Order Date]` | `]` ← `]]` | `"Order Date"` وقتی `QUOTED_IDENTIFIER` روشن باشد (پیش‌فرض) |
| Oracle | `"Order Date"` | `"` ← `""` | — |
| PostgreSQL | `"Order Date"` | `"` ← `""` | — |
| MySQL / MariaDB | `` `Order Date` `` | بک‌تیک ← دو بک‌تیک | `"…"` فقط با حالت SQL به نام `ANSI_QUOTES` |
| SQLite | `"Order Date"` | `"` ← `""` | `` `…` `` و `[…]` برای سازگاری با MySQL و SQL Server |
| ClickHouse | `` `Order Date` `` | بک‌تیک دوبرابر | `"…"` |
| Snowflake | `"Order Date"` | `"` ← `""` | — |
| Cassandra | `"Order Date"` | `"` ← `""` | — |

این جدول همان داده‌ای است که Rowlit برای نقل‌قول کردن نام‌هایی که می‌نویسد به کار می‌برد: `DialectInfo.IdentifierQuote` برای SQL Server `[ ]`، برای MySQL و ClickHouse بک‌تیک و برای بقیه گیومه برمی‌گرداند (SQLite بک‌تیک را می‌پذیرد اما Rowlit `"` می‌نویسد) و `DialectInfo.QuoteIdentifier` نویسهٔ بستن را دوبرابر می‌کند (`DialectInfo.cs:53-62`). ویژگی lexer به نام `BacktickIdentifiers` برای SQLite، MySQL و ClickHouse درست است (`:38-39`).

**تبدیل حروف (case folding).** با نام *بدون نقل‌قول* چه می‌شود؟ استاندارد می‌گوید به حروف بزرگ تبدیل شود؛ موتورها اختلاف دارند:

| موتور | `Orders` بدون نقل‌قول چگونه ذخیره و پیدا می‌شود | `"Orders"` نقل‌قول‌شده | برچسب Rowlit (`IdentifierRules.CaseFolding`) |
|---|---|---|---|
| Oracle | `ORDERS` (بزرگ) | دقیقاً `Orders` | `upper` |
| Snowflake | `ORDERS` (بزرگ) | دقیقاً `Orders` | `upper` |
| PostgreSQL | `orders` (کوچک) | دقیقاً `Orders` | `lower` |
| Cassandra | `orders` (کوچک) | دقیقاً `Orders` | `lower` |
| SQL Server | همان‌طور که تایپ شده؛ مقایسه از **collation** پیروی می‌کند (پیش‌فرض: حساس‌نبودن به حروف) | همان | `preserve` |
| MySQL / MariaDB | همان‌طور که تایپ شده؛ نام جدول در Linux حساس به حروف است و در Windows/macOS نه (`lower_case_table_names`) | همان | `preserve` |
| SQLite | همان‌طور که تایپ شده؛ حروف ASCII بدون حساسیت به حروف مقایسه می‌شوند | همان | `preserve` |
| ClickHouse | همان‌طور که تایپ شده؛ **حساس به حروف** | همان | `preserve` |

برچسب‌ها مستقیم از providerها می‌آیند: `new('"', '"', "upper", …)` برای Oracle و Snowflake، `"lower"` برای PostgreSQL و Cassandra، `"preserve"` برای بقیه (`OracleProvider.cs:65`، `SnowflakeProvider.cs:38`، `PostgreSqlProvider.cs:37`، `CassandraProvider.cs:28`، `SqlServerProvider.cs:19`، `MySqlProvider.cs:23`، `SqliteProvider.cs:51`، `ClickHouseProvider.cs:27`؛ رکورد در `CoreModels.cs:113-118`). پیامد، تلهٔ کلاسیک است:

</div>

```sql
-- PostgreSQL
CREATE TABLE "Orders" (id int);   -- stored as Orders, mixed case, forever needs quotes
SELECT * FROM Orders;             -- ERROR: relation "orders" does not exist
SELECT * FROM "Orders";           -- works
```

<div dir="rtl" markdown="1">

همین اشتباه در Oracle دنبال `ORDERS` می‌گردد و با `ORA-00942: table or view does not exist` شکست می‌خورد. همین دلیل است که جدول‌های آزمایشگاه در هر موتور نام متفاوت دارند: SQL Server حالت PascalCase را نگه می‌دارد (`Customers`، `CustomerId`)، Oracle و Snowflake از `UPPER_SNAKE` استفاده می‌کنند (`CUSTOMERS`، `COUNTRY_ID`) تا نام‌های بدون نقل‌قول پیدایشان کنند و PostgreSQL، MySQL، SQLite، ClickHouse و Cassandra از `lower_snake` (`ShopSchema.cs:8-9` و `:31-39`). **قاعده: مگر ناچار باشید از نام‌های نقل‌قول‌شدهٔ حروف مخلوط استفاده نکنید؛ اگر کردید، هر بار نقل‌قول کنید.**

**بیشینهٔ طول.** حدود ۶۳ بایت در PostgreSQL، ۶۴ نویسه در MySQL، ۱۲۸ در SQL Server و (از 12.2) Oracle، ۲۵۵ در Snowflake، ۴۸ در Cassandra برای نام keyspace و جدول. این‌ها حدهای «تا این نسخه»‌اند؛ نسخهٔ خودتان را بررسی کنید.

**نام‌های کامل.** تعداد نقطه‌ها از سلسله‌مراتب ۲٫۱ پیروی می‌کند:

| موتور | جدول کاملِ shop | نکات |
|---|---|---|
| SQL Server | `shop.dbo.Orders` | پرس‌وجوی میان‌پایگاهی با نام سه‌بخشی مجاز است؛ چهار بخش به linked server می‌رسد |
| Oracle | `SHOP.ORDERS` | schema یک کاربر است؛ جدول کاربران دیگر `GRANT SELECT` می‌خواهد |
| PostgreSQL | `public.orders` | هر اتصال به یک پایگاه بسته است؛ برای حذف schema از `search_path` (پایین) استفاده کنید؛ میان‌پایگاهی به `dblink` یا wrapper داده خارجی نیاز دارد |
| MySQL / MariaDB | `shop.orders` | «database» و «schema» مترادف‌اند؛ پرس‌وجوی میان‌پایگاهی عادی است |
| SQLite | `main.orders` | `ATTACH DATABASE 'archive.db' AS archive` schema دیگری اضافه می‌کند |
| ClickHouse | `shop.orders` | |
| Snowflake | `SHOP.PUBLIC.ORDERS` | `USE DATABASE` و `USE SCHEMA` پیش‌فرض می‌گذارند |
| Cassandra | `shop.orders` | `USE shop` keyspace پیش‌فرض را تعیین می‌کند |

PostgreSQL نام بدون پیشوند را از راه **[`search_path`](../glossary.md#search-path)** حل می‌کند، فهرستی از schemaها، به‌طور پیش‌فرض `"$user", public`: اولین schemaای که شیء را داشته باشد برنده است. فرم PostgreSQL در Rowlit برای آن فیلد `searchPath` دارد (`PgConnectionStrings.cs:31`).

### ۲٫۳ لیترال‌ها، کامنت‌ها و escape

| | متن | تاریخ و زمان | بولی | دودویی |
|---|---|---|---|---|
| SQL Server | `N'Zoë'` برای یونیکد، `'It''s'` | `'2026-01-05T10:00:00'` (ISO 8601 مستقل از زبان است؛ `'20260105'` هم) | ندارد: `BIT`، `1`/`0` | `0xDEADBEEF` |
| Oracle | `'It''s'`، `q'[It's]'` | `DATE '2026-01-05'`، `TIMESTAMP '2026-01-05 10:00:00'`، `TO_DATE('…','YYYY-MM-DD')` | `TRUE`/`FALSE` فقط در 23ai؛ قبلاً: `NUMBER(1)` | `HEXTORAW('DEADBEEF')` |
| PostgreSQL | `'It''s'`، `E'It\'s'`، `$$It's$$`، `$tag$…$tag$` | `DATE '2026-01-05'`، `'2026-01-05 10:00+00'::timestamptz` | `TRUE`، `FALSE` | `'\xDEADBEEF'` |
| MySQL / MariaDB | `'It''s'` و `'It\'s'` (escape با بک‌اسلش) | `DATE '2026-01-05'`، `'2026-01-05 10:00:00'` | `TRUE`، `FALSE` (= 1، 0) | `X'DEADBEEF'` |
| SQLite | `'It''s'` | نوع تاریخ ندارد: متن `'2026-01-05'` به‌علاوهٔ توابع | `TRUE`/`FALSE` از 3.23 (= 1، 0) | `X'DEADBEEF'` |
| ClickHouse | `'It\'s'` و `'It''s'` | `toDate('2026-01-05')`، `toDateTime('2026-01-05 10:00:00')` | `true`، `false` (`Bool`) | `unhex('DEADBEEF')` |
| Snowflake | `'It''s'`، `'It\'s'`، `$$It's$$` | `DATE '2026-01-05'`، `'2026-01-05'::DATE` | `TRUE`، `FALSE` | `X'DEADBEEF'` |
| Cassandra | `'It''s'`، `$$It's$$` | رشته‌های `'2026-01-05'`، `'2026-01-05T10:00:00Z'` | `true`، `false` | `0xDEADBEEF` |

قاعده‌های escape رشته ویژگی‌های lexer در `DialectInfo` هستند: در MySQL، ClickHouse و Snowflake بک‌اسلش نویسهٔ بعدی را درون `'…'` escape می‌کند (`BackslashStringEscapes`، خط ۴۵)؛ بدنه‌های `$$…$$` و `$tag$…$tag$` در PostgreSQL، Snowflake، CQL و DuckDB هستند (`DollarQuotedStrings`، خط ۴۸). عملاً مهم است: متن `C:\temp` در PostgreSQL رشتهٔ ساده است ولی در MySQL escape دارد، و ابزاری که فرق را نداند دستورها را در جای اشتباه می‌شکند.

**کامنت‌ها.**

| | `-- خطی` | `/* بلوکی */` | دیگر |
|---|---|---|---|
| SQL Server | بله | بله، **تو‌در‌تو** | |
| Oracle | بله | بله | |
| PostgreSQL | بله | بله، **تو‌در‌تو** | |
| MySQL / MariaDB | بله، اما بعد از `--` فاصله لازم است | بله | `# خطی` |
| SQLite | بله | بله | |
| ClickHouse | بله | بله | `# خطی` |
| Snowflake | بله | بله | `// خطی` |
| Cassandra | بله | بله | `// خطی` |

ویژگی‌ها `NestedBlockComments` (SQL Server، PostgreSQL، DuckDB)، `HashLineComments` (MySQL، ClickHouse) و `SlashLineComments` (CQL، Snowflake) هستند (`DialectInfo.cs:35-51`). کامنت بلوکی تو‌در‌تو اجازه می‌دهد کدی را که خودش کامنت دارد کامنت کنید، اما در موتوری که تو‌در‌تو نمی‌شود اولین `*/` کامنت را زود می‌بندد و بقیه به‌عنوان SQL تجزیه می‌شود.

### ۲٫۴ NULL، رشتهٔ خالی، مرتب‌سازی و بولی

- **رشتهٔ خالی در برابر NULL.** در **Oracle** `''` همان `NULL` *است*: `WHERE name = ''` هرگز منطبق نمی‌شود، `LENGTH('')` برابر `NULL` است و ستون `NOT NULL` مقدار `''` را رد می‌کند. موتورهای دیگر این‌ها را مقدارهای متفاوت می‌دانند. ویرایشگر داده در Rowlit این را کد کرده: برای `plsql` رشتهٔ خالی null شمرده می‌شود (`ui/src/data/sqlgen.ts:68`).
- **NULLها کجا مرتب می‌شوند.** بدون دستور صریح:

| موتور | `ORDER BY x ASC` NULLها را می‌گذارد | کلیدواژهٔ `NULLS FIRST` / `NULLS LAST` |
|---|---|---|
| SQL Server | اول (NULL کوچک‌ترین است) | پشتیبانی نمی‌شود |
| Oracle | آخر (NULL بزرگ‌ترین است) | پشتیبانی می‌شود |
| PostgreSQL | آخر | پشتیبانی می‌شود |
| MySQL / MariaDB | اول | پشتیبانی نمی‌شود |
| SQLite | اول | از 3.30 |
| ClickHouse | آخر | پشتیبانی می‌شود |
| Snowflake | آخر (با پارامتر نشست قابل تنظیم) | پشتیبانی می‌شود |
| Cassandra | NULL در کلید نیست؛ `ORDER BY` فقط روی ستون‌های خوشه‌بندی | کاربرد ندارد |

  برای یکسان کردن ترتیب در همه‌جا روی عبارت مرتب کنید: `ORDER BY (x IS NULL), x` در موتورهایی که false قبل از true می‌آید NULLها را آخر می‌گذارد، یا `ORDER BY CASE WHEN x IS NULL THEN 1 ELSE 0 END, x` در همه.
- **الحاق با NULL.** `'a' || NULL` در PostgreSQL، SQLite، Snowflake و ClickHouse برابر `NULL` است، اما `||` در Oracle با NULL مثل رشتهٔ خالی رفتار می‌کند (`'a' || NULL` برابر `'a'` است). در SQL Server `'a' + NULL` برابر `NULL` است (با `CONCAT_NULL_YIELDS_NULL ON` پیش‌فرض)، در حالی که `CONCAT('a', NULL)` مقدار `'a'` برمی‌گرداند. در MySQL `||` یعنی OR منطقی مگر `PIPES_AS_CONCAT` تنظیم شود؛ از `CONCAT()` استفاده کنید.
- **بولی.** SQL Server نوع بولی ندارد، پس `WHERE active` نامعتبر است؛ بنویسید `WHERE active = 1`. `BOOLEAN` در MySQL همان `TINYINT(1)` است. Oracle در 23ai `BOOLEAN` واقعی اضافه کرد؛ پیش از آن `NUMBER(1)`. SQLite ۰ و ۱ ذخیره می‌کند.
- **تقسیم صحیح.** `7 / 2` در SQL Server، PostgreSQL و SQLite برابر `3` است (عملوند صحیح، نتیجهٔ صحیح). Oracle `3.5` می‌دهد چون عددهایش اعشاری‌اند. MySQL `3.5000`، Snowflake عددی اعشاری مانند `3.500000` و ClickHouse `3.5` (`/` اعشاری است؛ برای نتیجهٔ صحیح `intDiv`). وقتی نسبت مهم است همیشه cast کنید.

### ۲٫۵ محدود کردن سطر و صفحه‌بندی

| موتور | ۱۰ سطر اول | سطرهای ۲۱ تا ۳۰ |
|---|---|---|
| SQL Server | `SELECT TOP 10 * FROM dbo.Orders ORDER BY Id` | `… ORDER BY Id OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY` (`ORDER BY` لازم است) |
| Oracle | `… ORDER BY ID FETCH FIRST 10 ROWS ONLY` (12c به بعد)؛ قبلاً: `WHERE ROWNUM <= 10` روی زیرپرس‌وجو | `… ORDER BY ID OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY` |
| PostgreSQL | `… ORDER BY id LIMIT 10` | `… LIMIT 10 OFFSET 20` |
| MySQL / MariaDB | `… LIMIT 10` | `… LIMIT 10 OFFSET 20` (یا `LIMIT 20, 10`: اول offset!) |
| SQLite | `… LIMIT 10` | `… LIMIT 10 OFFSET 20` |
| ClickHouse | `… LIMIT 10` | `… LIMIT 10 OFFSET 20` (یا `LIMIT 20, 10`)؛ همچنین `LIMIT 2 BY customer_id` (۲ سطر برتر در هر گروه) |
| Snowflake | `… LIMIT 10` یا `TOP 10` یا `FETCH FIRST 10 ROWS ONLY` | `… LIMIT 10 OFFSET 20` |
| Cassandra | `… LIMIT 10` | **`OFFSET` ندارد**؛ با paging state درایور صفحه‌بندی کنید |

گرید دادهٔ Rowlit دقیقاً همین شکل‌ها را تولید می‌کند: T-SQL `OFFSET … FETCH NEXT` می‌گیرد و پیش از SQL Server 2012 به `TOP` برمی‌گردد؛ Oracle `OFFSET … FETCH` می‌گیرد و پیش از 12c به پوشش `ROWNUM`؛ هر گویش دیگر `LIMIT … OFFSET …` (`ui/src/data/sqlgen.ts:466-487`). به یاد داشته باشید صفحه‌بندی با `OFFSET` همهٔ سطرهای قبلی را می‌خواند و دور می‌ریزد، پس صفحه‌های عمیق کندتر می‌شوند؛ صفحه‌بندی keyset را در [فصل ۱۳](13-performance-tuning.md) ببینید.

### ۲٫۶ توابع روزمره

| کار | SQL Server | Oracle | PostgreSQL | MySQL / MariaDB | SQLite | ClickHouse | Snowflake |
|---|---|---|---|---|---|---|---|
| اکنون | `SYSDATETIME()`، `GETDATE()` | `SYSTIMESTAMP`، `SYSDATE` | `now()` | `NOW()` | `datetime('now')` | `now()` | `CURRENT_TIMESTAMP()` |
| ۷ روز اضافه | `DATEADD(day, 7, d)` | `d + 7` | `d + interval '7 days'` | `DATE_ADD(d, INTERVAL 7 DAY)` | `date(d, '+7 day')` | `d + INTERVAL 7 DAY` | `DATEADD(day, 7, d)` |
| سال یک تاریخ | `YEAR(d)` | `EXTRACT(YEAR FROM d)` | `EXTRACT(year FROM d)` | `YEAR(d)` | `strftime('%Y', d)` | `toYear(d)` | `YEAR(d)` |
| آغاز ماه | `DATEFROMPARTS(YEAR(d), MONTH(d), 1)` | `TRUNC(d, 'MM')` | `date_trunc('month', d)` | `DATE_FORMAT(d, '%Y-%m-01')` | `date(d, 'start of month')` | `toStartOfMonth(d)` | `DATE_TRUNC('month', d)` |
| الحاق رشته | `CONCAT(a, b)` یا `a + b` | `a \|\| b` | `a \|\| b` | `CONCAT(a, b)` | `a \|\| b` | `concat(a, b)` | `a \|\| b` |
| طول | `LEN(s)` (فاصلهٔ انتها را نمی‌شمارد)، `DATALENGTH` | `LENGTH(s)` | `length(s)` | `CHAR_LENGTH(s)` | `length(s)` | `length(s)` (بایت)، `lengthUTF8` | `LENGTH(s)` |
| اولین غیر null | `ISNULL(a, b)`، `COALESCE` | `NVL(a, b)`، `COALESCE` | `COALESCE` | `IFNULL`، `COALESCE` | `IFNULL`، `COALESCE` | `ifNull`، `coalesce` | `NVL`، `IFNULL`، `COALESCE` |
| فیلد JSON | `JSON_VALUE(j, '$.tier')` | `JSON_VALUE(j, '$.tier')` | `j ->> 'tier'` | `j ->> '$.tier'` | `j ->> '$.tier'` (3.38+) | `JSONExtractString(j, 'tier')` | `j:tier::string` |

Cassandra توابع اسکالر کمی دارد (`now()`، `toTimestamp()`، `uuid()`، `toDate()`، `token()`)؛ حساب تاریخ و توابع رشته‌اش محدود است. `LEN` در SQL Server فاصله‌های انتها را نادیده می‌گیرد، منبع مکرر «چرا ۵ شد نه ۶».

### ۲٫۷ نوع داده و کلیدهای تولیدی

دادهٔ اولیهٔ `shop` در هر موتور ستون‌های یکسان تعریف می‌کند. خواندنشان نگاشت نوع‌ها را نشان می‌دهد:

| معنا | SQL Server | Oracle | PostgreSQL | MySQL | SQLite | ClickHouse | Snowflake | Cassandra |
|---|---|---|---|---|---|---|---|---|
| کلید صحیح ۳۲ بیتی | `INT` | `NUMBER(10)` | `integer` | `INT` | `INTEGER` | `UInt32` | `NUMBER(38,0)` | `int` |
| پول | `DECIMAL(12,2)` | `NUMBER(12,2)` | `numeric(12,2)` | `DECIMAL(12,2)` | `DECIMAL(12,2)` (affinity عددی) | `Decimal(12, 2)` | `NUMBER(12,2)` | `decimal` |
| متن محدود | `NVARCHAR(100)` | `VARCHAR2(100)` | `varchar(100)` | `VARCHAR(100)` | `TEXT` | `String` | `VARCHAR(100)` | `text` |
| زمان‌مهر | `DATETIME2` | `DATE` (بخش زمان هم دارد!) | `timestamptz` | `DATETIME` | `DATETIME` (به‌صورت متن/عدد ذخیره می‌شود) | `DateTime('UTC')` | `TIMESTAMP_NTZ` | `timestamp` |
| شناسهٔ یکتا | `UNIQUEIDENTIFIER` | `RAW(16)` | `uuid` | `CHAR(36)` / `BINARY(16)` | `TEXT` | `UUID` | `VARCHAR` | `uuid`، `timeuuid` |
| JSON | `NVARCHAR(MAX)` + `JSON_VALUE` | `JSON` (21c+) / `CLOB` | `jsonb` | `JSON` | `TEXT` + توابع JSON | `JSON` / `String` | `VARIANT` | `text` |

برای تعریف دقیق، دستورهای `CREATE TABLE` دادهٔ اولیه را بخوانید: `seed-mssql.sql:30-52`، `seed-postgres.sql:28-53`، `seed-mysql.sql:20-70`، `seed-clickhouse.sql:21-95` و بلوک‌های جدول در `seed-oracle.sql` و `seed-snowflake.sql`. سه تلهٔ نوع: **SQLite** *نوع‌دهی پویا با affinity* دارد، پس ستون `DECIMAL(12,2)` ممکن است اعشاری یا متن ذخیره کند مگر جدول `STRICT` باشد (3.37+)؛ **`DATE` در Oracle** ساعت، دقیقه و ثانیه دارد؛ **ClickHouse** `Nullable(T)` را جدا می‌کند که فضا و سرعت خرج دارد، پس ستون‌ها به‌طور پیش‌فرض غیر null‌اند (`email Nullable(String)` در دادهٔ اولیه عمدی است).

**کلیدهای تولیدی.** شناسهٔ خودکار ([identity column](../glossary.md#identity-column)، [auto_increment](../glossary.md#auto-increment) در MySQL، [serial](../glossary.md#serial) قدیمی PostgreSQL) و «شناسه‌ای که همین ساختم را بده» فرق دارد:

| موتور | تعریف | خواندن کلید تازه |
|---|---|---|
| SQL Server | `Id INT IDENTITY(1,1)`؛ یا `SEQUENCE` | `OUTPUT INSERTED.Id`، `SCOPE_IDENTITY()` |
| Oracle | `ID NUMBER GENERATED BY DEFAULT AS IDENTITY` (12c+)؛ یا `SEQUENCE` و `seq.NEXTVAL` | `INSERT … RETURNING id INTO :out` |
| PostgreSQL | `id integer GENERATED BY DEFAULT AS IDENTITY`؛ قدیمی‌تر `serial` | `INSERT … RETURNING id` |
| MySQL | `id INT AUTO_INCREMENT PRIMARY KEY`؛ MariaDB `SEQUENCE` هم دارد | `SELECT LAST_INSERT_ID()` |
| SQLite | `id INTEGER PRIMARY KEY` (نام مستعار rowid)؛ `AUTOINCREMENT` از استفادهٔ دوباره جلوگیری می‌کند | `RETURNING id` (3.35+)، `last_insert_rowid()` |
| ClickHouse | ندارد؛ از `generateUUIDv4()` یا شناسه‌های برنامه | در دسترس نیست |
| Snowflake | `IDENTITY(1,1)` / `AUTOINCREMENT`؛ یا `SEQUENCE` | از sequence بپرسید یا مقدار بازگشتی را به کار ببرید |
| Cassandra | ندارد؛ `uuid()` / `timeuuid` (`now()`) | خودتان تولید کرده‌اید |

مولد درج Rowlit دقیقاً همین دنباله‌ها را می‌نویسد: `OUTPUT INSERTED … INTO @ins` یا `SCOPE_IDENTITY()` برای T-SQL، `RETURNING … INTO :out` برای Oracle، `RETURNING` برای PostgreSQL، `LAST_INSERT_ID()` برای MySQL، `RETURNING` یا `last_insert_rowid()` برای SQLite و هیچ برای ClickHouse (`ui/src/data/sqlgen.ts:320-374`).

### ۲٫۸ پارامترها و جداکننده‌های دسته

**جانگهدارها** (نحو [متغیر پیوندی (bind variable)](../glossary.md#bind-variable) در متن دستور؛ [فصل ۱۴](14-security.md) را هم ببینید):

| موتور | آنچه سرور یا درایور می‌پذیرد | آنچه Rowlit هم می‌پذیرد (به شکل بومی بازنویسی می‌کند) |
|---|---|---|
| SQL Server | `@name`؛ نام‌هایی که با `DECLARE` در همان دسته تعریف شده‌اند متغیرند نه پارامتر؛ `?` رد می‌شود | فقط `@name` |
| Oracle | `:name`، `:1` | `:name`، `:1` |
| PostgreSQL | `$1`، `$2`، … (موقعیتی) | `:name` و `@name` که به `$k` بازنویسی می‌شوند؛ `?` هرگز جانگهدار نیست چون عملگر jsonb است |
| MySQL / MariaDB | `?` (دستور آماده)، `@var` متغیر کاربر است | `:name`، `@name` (فقط اگر مقدار داده شود)، `?` |
| SQLite | `?`، `?NNN`، `:name`، `@name`، `$name` | همهٔ این‌ها؛ `?` ساده به نام‌دار بازنویسی می‌شود |
| ClickHouse | `{name:Type}` (نوع‌دار، سمت سرور) | `:name`، `@name` که به `{name:Type}` بازنویسی می‌شوند |
| Snowflake | `?`، `:1`، `:name` (متغیر پیوندی یا Scripting) | `:name`، `:1`، `?`؛ هرگز `$1` (ستون فایل staged) |
| Cassandra | `?`، `:name` | `?`، `:name` |

ستون راست قابلیت ابزار است نه سرور. ارجاع‌های Rowlit: SQL Server (`SqlServerParamBinder.cs:11-16`)، Oracle (`OracleParamBinder.cs:10-17`)، PostgreSQL (`PgParamBinder.cs:9-16`)، MySQL (`MySqlParamBinder.cs:11-17`)، SQLite (`SqliteParamBinder.cs:12-19`)، ClickHouse (`ChParamBinder.cs:12-26`)، Snowflake (`SnowflakeParamBinder.cs:12-18`)، Cassandra (`CqlSession.cs:622-627` که نبود مقدار موقعیتی یا نام‌دار را گزارش می‌کند).

**جداکننده‌های دسته و پایان‌دهنده‌های دستور.** `;` در هر موتور دستور را پایان می‌دهد، اما بعضی گویش‌ها یک واژهٔ *سمت کلاینت* برای پایان **[دسته (batch)](../glossary.md#batch-separator)** دارند (گروهی که با هم به سرور فرستاده می‌شود):

| موتور | جداکننده | چه کسی می‌فهمد | نکات |
|---|---|---|---|
| SQL Server | [`GO`](../glossary.md#go) در یک خط تنها (`GO 5` پنج بار تکرار می‌کند) | ابزار کلاینت (SSMS، `sqlcmd`)، **نه سرور** | `CREATE PROCEDURE`، `CREATE VIEW` و مانند آن باید تنها در دسته باشند؛ متغیرها از `GO` عبور نمی‌کنند |
| Oracle | `/` در یک خط تنها بلوک PL/SQL را پایان می‌دهد | SQL\*Plus و کلاینت‌های سازگار | بلوک‌های PL/SQL `;` دارند، پس `;` نمی‌تواند پایانشان دهد؛ دستورهای SQL ساده در اسکریپتی که `/` دارد بدون `;` انتها نوشته می‌شوند (مثل `seed-oracle.sql` آزمایشگاه) |
| PostgreSQL | ندارد؛ `;` | `psql` دستور `\g` دارد | بدنه‌های `$$ … $$` نقطه‌ویرگول درونی را پنهان می‌کنند |
| MySQL / MariaDB | [`DELIMITER //`](../glossary.md#delimiter) پایان‌دهنده را عوض می‌کند | کلاینت `mysql`، **نه سرور** | دور `CREATE PROCEDURE … BEGIN … END` لازم است |
| SQLite | `;` | | |
| ClickHouse | `;` | | یک دستور در هر درخواست HTTP |
| Snowflake | `;` | | `$$ … $$` و بلوک‌های Scripting به شکل `BEGIN … END;` |
| Cassandra | `;` | | `BEGIN BATCH … APPLY BATCH` ساختار *سرور* است (یک واحد نوشتن اتمی)، نامرتبط با دسته‌های کلاینت |

درایور هر بار یک فرمان می‌فرستد. اگر اسکریپتی با `GO` یا `DELIMITER` را به درایور بدهید، سرور خطای نحوی می‌بیند: این واژه‌ها برای کلاینت‌اند. پس ابزاری مانند Rowlit باید خودش تقسیم کند. این کار در لایهٔ ویرایشگر با TypeScript انجام می‌شود (`ui/src/intel/split/splitter.ts`): دسته‌های T-SQL با خط‌های `GO [n]`، بلوک‌های Oracle با خط‌های `/`، MySQL با `DELIMITER` (`split/mysql.ts:4-8`)، بلوک‌های Snowflake Scripting (`split/snowflake.ts:1-6`) و `BEGIN BATCH … APPLY BATCH` در CQL (`split/cql.ts:1-5`). سمت موتور یک تقسیم‌کنندهٔ T-SQL کوچک‌تر برای عیب‌یابی دارد و یادآوری می‌کند که «UI صاحب تقسیم برای اجرا است» (`engine/src/DbStudio.Providers.SqlServer/TSql/BatchSplitter.cs:12`). ClickHouse حالت وارونه است: موتور دسته را به دستورها می‌شکند و هر کدام را در درخواست HTTP جداگانه می‌فرستد (`ChSession.cs:19`).

### ۲٫۹ کد رویه‌ای

یک کار کوچک، «۱۹٪ مالیات به مبلغ اضافه کن»، به‌صورت تابع ذخیره‌شده. پنج مورد اول از دادهٔ اولیهٔ آزمایشگاه می‌آیند:

</div>

```sql
-- PostgreSQL (seed-postgres.sql)
CREATE FUNCTION public.fn_tax(amount numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$ SELECT amount * 0.19 $$;

-- SQL Server (seed-mssql.sql)
CREATE FUNCTION dbo.fnTax (@amount DECIMAL(12,2)) RETURNS DECIMAL(12,2) AS
BEGIN
    RETURN @amount * 0.19;
END

-- Oracle (seed-oracle.sql)
CREATE OR REPLACE FUNCTION FN_TAX(p_amount IN NUMBER) RETURN NUMBER IS
BEGIN
  RETURN ROUND(p_amount * 0.19, 2);
END FN_TAX;
/

-- MySQL (seed-mysql.sql)
CREATE FUNCTION fn_tax(amount DECIMAL(12,2)) RETURNS DECIMAL(12,2)
  DETERMINISTIC NO SQL
BEGIN
  RETURN amount * 0.19;
END

-- ClickHouse (seed-clickhouse.sql): a user-defined function is just a lambda
CREATE OR REPLACE FUNCTION tax AS (amount) -> amount * 0.19;
```

<div dir="rtl" markdown="1">

یادداشتی دربارهٔ هر زبان:

- **T-SQL** (Transact-SQL): متغیرها `@name` هستند (`DECLARE @x INT`)، بلوک‌ها `BEGIN … END`، خطاها با `TRY … CATCH` و `THROW`، خروجی با `PRINT`، رویه‌ها پارامتر `OUTPUT` دارند و رویه می‌تواند چند مجموعه‌نتیجه برگرداند.
- **PL/SQL**: بلوک‌های `DECLARE … BEGIN … EXCEPTION … END;`، **package**ها (مشخصه به‌علاوهٔ بدنه که رویه‌ها و توابع را گروه می‌کند)، `DBMS_OUTPUT.PUT_LINE` برای پیام و پارامتر `REF CURSOR` برای برگرداندن سطر. `ORDER_API` آزمایشگاه یک package است.
- **PL/pgSQL**: زبانی که برای هر تابع با `LANGUAGE plpgsql` انتخاب می‌کنید (دیگران: `sql`، Perl، Python…)، بدنه‌ها بین `$$…$$`، `RAISE NOTICE` برای پیام، `DO $$ … $$` برای بلوک بی‌نام، `CALL` برای رویه (از 11).
- **برنامه‌های ذخیره‌شدهٔ MySQL**: رویه، تابع، trigger و event؛ بدنه با چند دستور در کلاینت `mysql` به `DELIMITER` نیاز دارد؛ handlerها `DECLARE … HANDLER` اند.
- **SQLite** رویهٔ ذخیره‌شده ندارد؛ منطق در triggerها (آزمایشگاه `trg_orders_total_check` دارد) و برنامهٔ میزبان است.
- **ClickHouse** تابع SQL تعریف‌شده توسط کاربر (بالا) و توابع اجرایی خارجی دارد، رویه ندارد.
- **Snowflake Scripting** زبان بلوکی مبتنی بر SQL است (`DECLARE … BEGIN … END;`)؛ رویه‌ها را با JavaScript، Python، Java یا Scala هم می‌توان نوشت. بدنه‌ها معمولاً در `$$ … $$` پیچیده می‌شوند.
- **Cassandra** [نوع تعریف‌شده توسط کاربر](../glossary.md#udt) (UDT، مانند نوع `address` دادهٔ اولیه)، تابع و تجمیع تعریف‌شده توسط کاربر دارد (`line_total` دادهٔ اولیه Java است و با `user_defined_functions_enabled` فعال می‌شود)، رویه ندارد.

### ۲٫۱۰ فراداده کجا زندگی می‌کند

هر موتور خودش را در جدول‌ها یا viewهایی توصیف می‌کند که می‌توانید پرس‌وجو کنید. نام‌ها فرق دارند: [`information_schema`](../glossary.md#information-schema) (استاندارد؛ PostgreSQL، MySQL، Snowflake، SQL Server)، [viewهای کاتالوگ `sys`](../glossary.md#sys-catalog-views) (SQL Server)، [`pg_catalog`](../glossary.md#pg-catalog) (PostgreSQL)، [viewهای `ALL_*`](../glossary.md#all-views) (Oracle)، [`sqlite_master`](../glossary.md#sqlite-master) (SQLite)، [جدول‌های `system.*`](../glossary.md#system-tables) (ClickHouse) و [`system_schema`](../glossary.md#system-schema) (Cassandra). این پرس‌وجوها جدول‌ها و ستون‌های داده `shop` را در هر موتور فهرست می‌کنند:

#### PostgreSQL — `information_schema` و `pg_catalog`

</div>

```sql
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema IN ('public', 'sales')
ORDER BY table_schema, table_name, ordinal_position;
```

<div dir="rtl" markdown="1">

`information_schema` view استاندارد قابل‌حمل است؛ `pg_catalog` (`pg_class`، `pg_attribute`، `pg_namespace`، `pg_type`) کاتالوگ واقعی و غنی‌تر است که psql و Rowlit می‌خوانند.

#### SQL Server — viewهای کاتالوگ `sys`

</div>

```sql
SELECT s.name AS [schema], t.name AS [table], c.name AS [column], ty.name AS [type]
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
ORDER BY s.name, t.name, c.column_id;
```

<div dir="rtl" markdown="1">

#### Oracle — `ALL_*`، `USER_*`، `DBA_*`

</div>

```sql
SELECT table_name, column_name, data_type
FROM all_tab_columns
WHERE owner = 'SHOP'
ORDER BY table_name, column_id;
```

<div dir="rtl" markdown="1">

viewهای `USER_*` اشیای خودتان را نشان می‌دهند، `ALL_*` آنچه اجازهٔ دیدنش را دارید و `DBA_*` همه‌چیز را (دسترسی لازم است). viewهای `V$` نمونهٔ در حال اجرا را نشان می‌دهند.

#### MySQL / MariaDB — `information_schema`

</div>

```sql
SELECT table_name, column_name, column_type
FROM information_schema.columns
WHERE table_schema = 'shop'
ORDER BY table_name, ordinal_position;
```

<div dir="rtl" markdown="1">

#### SQLite — `sqlite_master` و `pragma_*`

</div>

```sql
SELECT m.name AS "table", p.name AS "column", p.type
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\'
ORDER BY m.name, p.cid;
```

<div dir="rtl" markdown="1">

#### ClickHouse — `system.*`

</div>

```sql
SELECT `table`, name, type
FROM system.columns
WHERE database = 'shop'
ORDER BY `table`, position;
```

<div dir="rtl" markdown="1">

#### Snowflake — `INFORMATION_SCHEMA` و `SHOW`

</div>

```sql
SELECT table_name, column_name, data_type
FROM SHOP.INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = 'PUBLIC'
ORDER BY table_name, ordinal_position;
```

<div dir="rtl" markdown="1">

`INFORMATION_SCHEMA` [انبار (warehouse)](../glossary.md#warehouse) روشن می‌خواهد (به [فصل ۱۵](15-oltp-vs-olap-columnar.md) نگاه کنید)؛ `SHOW TABLES` / `DESCRIBE TABLE` / `GET_DDL(...)` در لایهٔ سرویس‌های ابری اجرا می‌شوند و هیچ انباری نمی‌خواهند، که Rowlit از آن استفاده می‌کند (`SnowflakeCatalogReader.cs:12-13`). تاریخچهٔ سطح حساب در `SNOWFLAKE.ACCOUNT_USAGE` است.

#### Cassandra — `system_schema`

</div>

```sql
SELECT table_name, column_name, type, kind
FROM system_schema.columns
WHERE keyspace_name = 'shop';
```

<div dir="rtl" markdown="1">

این‌ها با پرس‌وجوهای کاتالوگ providerهای Rowlit هم‌خوانی دارند: `sys.objects` و `sys.columns` (`SqlServerCatalogQueries.cs`)، `pg_class` و `pg_attribute` (`PgCatalogQueries.cs`)، `all_tab_cols` و `all_objects` (`OracleCatalogQueries.cs`)، `information_schema.TABLES` و `COLUMNS` (`MySqlCatalogQueries.cs`)، `sqlite_master` و `pragma_table_xinfo` (`SqliteCatalogReader.cs:184-194`)، `system.tables` و `system.columns` (`ChCatalogReader.cs`)، دستورهای `SHOW` (`SnowflakeCatalogReader.cs`) و `system_schema.keyspaces` و `system_schema.columns` (`CqlSchema.cs`).

### ۲٫۱۱ تراکنش و DDL

| موتور | autocommit پیش‌فرض | شروع تراکنش | DDL درون تراکنش | ایزولاسیون پیش‌فرض |
|---|---|---|---|---|
| SQL Server | روشن | `BEGIN TRAN` | تراکنشی (بازگردانی می‌شود) | READ COMMITTED (قفل‌گذاری؛ snapshot اختیاری) |
| Oracle | **همیشه در تراکنش**؛ commit صریح | ضمنی؛ اولین DML یکی شروع می‌کند | **commit ضمنی** پیش و پس از DDL | READ COMMITTED |
| PostgreSQL | روشن | `BEGIN` | تراکنشی (بازگردانی می‌شود) | READ COMMITTED |
| MySQL / MariaDB | روشن | `START TRANSACTION` | **commit ضمنی** | REPEATABLE READ (InnoDB) |
| SQLite | روشن | `BEGIN` | تراکنشی | SERIALIZABLE (یک نویسنده) |
| ClickHouse | سطح دستور | **ندارد** | کاربرد ندارد | کاربرد ندارد |
| Snowflake | روشن | `BEGIN` | **DDL تراکنش باز را commit می‌کند** | READ COMMITTED |
| Cassandra | به‌ازای هر دستور | **ندارد** (batch، تراکنش سبک) | کاربرد ندارد | کاربرد ندارد |

ستون «DDL درون تراکنش» پرچمی در کد Rowlit است: `TransactionalDdl: true` برای PostgreSQL، SQL Server و SQLite، و `false` برای Oracle، MySQL، ClickHouse، Snowflake و Cassandra (`PgDdlScripter.cs:56`، `SqlServerDdlScripter.cs:52`، `SqliteDdlScripter.cs:42`، `OracleDdlScripter.cs:50`، `MySqlDdlScripter.cs:63`، `ChDdlScripter.cs:82`، `SnowflakeDdlScripter.cs:53`، `CqlDdlScripter.cs:62`). تعیین می‌کند تغییر چنددستوری ناموفق schema را می‌توان بازگرداند یا schemaای نیمه‌اعمال‌شده می‌ماند.

واقعیت‌های سطح نشست از کلاس‌های نشست می‌آیند: Oracle «همیشه در تراکنش ضمنی است» و در حالت خودکار پس از هر دسته commit می‌کند (`OracleSession.cs:41`)؛ MySQL می‌گوید DDL ضمناً commit می‌کند (`MySqlSession.cs:20`)؛ Snowflake پیش از DDL تراکنش باز را commit می‌کند (`SnowflakeSession.cs:23-25`)؛ ClickHouse حالت دستی را `NOT_SUPPORTED` جواب می‌دهد (`ChSession.cs:25`، `:32-33`)؛ Cassandra دستورهای `BEGIN`/`COMMIT`/`ROLLBACK` را رد می‌کند و به batch و تراکنش سبک ارجاع می‌دهد (`CqlSession.cs:32-35`). **نقطهٔ ذخیره (savepoint)** در T-SQL با `SAVE TRANSACTION name` و در بقیه `SAVEPOINT name` است (`sqlgen.ts:405`).

### ۲٫۱۲ گرفتن طرح اجرا

| موتور | طرح تخمینی (چیزی اجرا نمی‌شود) | طرح واقعی (پرس‌وجو اجرا می‌شود) |
|---|---|---|
| SQL Server | `SET SHOWPLAN_XML ON` | `SET STATISTICS XML ON` |
| Oracle | `EXPLAIN PLAN FOR …` و بعد `DBMS_XPLAN.DISPLAY` | اجرا و بعد `DBMS_XPLAN.DISPLAY_CURSOR(…, 'ALLSTATS LAST')` |
| PostgreSQL | `EXPLAIN (FORMAT JSON) …` | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) …` |
| MySQL | `EXPLAIN FORMAT=JSON …` | `EXPLAIN ANALYZE …` (8.0.18+) |
| MariaDB | `EXPLAIN FORMAT=JSON …` | `ANALYZE FORMAT=JSON …` |
| SQLite | `EXPLAIN QUERY PLAN …` | همان (آمار زمان اجرا ندارد) |
| ClickHouse | `EXPLAIN json = 1, indexes = 1 …`، `EXPLAIN PIPELINE …` | اجرا و بعد خواندن `system.query_log` |
| Snowflake | `EXPLAIN USING JSON …` | اجرا و بعد `GET_QUERY_OPERATOR_STATS('<query id>')` یا Query Profile |
| Cassandra | `EXPLAIN` ندارد | `TRACING ON` |

این‌ها دستورهایی‌اند که خواننده‌های طرح Rowlit صادر می‌کنند (`SqlServerPlanReader.cs:10-15`، `OraclePlanReader.cs:11-17`، `PgPlanReader.cs:11-17` و ثابت‌ها در `:21-22`، `MySqlPlanReader.cs:12-18`، `SqlitePlanReader.cs:9-12`، `ChPlanReader.cs:12-18`، `SnowflakePlanReader.cs:11-18`، `CqlSession.cs:37-39`). خواندن طرح‌ها موضوع [فصل ۸](08-query-processing.md) است.

### ۲٫۱۳ Upsert و merge

«این سطر را درج کن، یا اگر هست به‌روز کن» ([فصل ۴](04-sql-advanced.md)) بیشترین گونه را دارد:

| موتور | نحو |
|---|---|
| SQL Server، Oracle، Snowflake | `MERGE INTO target USING source ON … WHEN MATCHED THEN UPDATE … WHEN NOT MATCHED THEN INSERT …` |
| PostgreSQL | `INSERT … ON CONFLICT (id) DO UPDATE SET …` (و `MERGE` از 15) |
| MySQL / MariaDB | `INSERT … ON DUPLICATE KEY UPDATE …` یا `REPLACE INTO` (حذف و درج) |
| SQLite | `INSERT … ON CONFLICT (id) DO UPDATE …` یا `INSERT OR REPLACE` |
| ClickHouse | معناشناسی به‌روزرسانی ندارد: نسخهٔ تازه را در `ReplacingMergeTree` درج کنید ([فصل ۱۵](15-oltp-vs-olap-columnar.md)) |
| Cassandra | هر `INSERT` یک upsert است؛ `IF NOT EXISTS` آن را مشروط می‌کند |

### ۲٫۱۴ یک ترجمهٔ کامل

**پرسش:** «سه مشتری برتر بر اساس درآمد از ۱ ژانویهٔ ۲۰۲۶ کدام‌اند، با کشورشان؟» دادهٔ اولیه (در همهٔ موتورهای رابطه‌ای یکسان) این پاسخ را می‌دهد که با دست محاسبه شده:

| name | country | revenue |
|---|---|---|
| Dora | Germany | 254.25 |
| Bob | France | 199.00 |
| Alice | Germany | 140.00 |

(Dora: سفارش‌های ۵ و ۶، 5.25 + 249.00؛ Bob: سفارش ۳، 199.00؛ Alice: سفارش‌های ۱ و ۲، 120.50 + 19.50. Chie مبلغ 54.15 دارد و Emil سفارشی ندارد.)

#### PostgreSQL

</div>

```sql
SELECT c.name, k.name AS country, SUM(o.total) AS revenue
FROM public.customers c
JOIN public.orders o ON o.customer_id = c.id
LEFT JOIN public.countries k ON k.id = c.country_id
WHERE o.order_date >= DATE '2026-01-01'
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

<div dir="rtl" markdown="1">

#### SQL Server

نام‌ها PascalCase هستند، `LIMIT` وجود ندارد (از `TOP` استفاده کنید) و لیترال تاریخ شکل مستقل از زبان است:

</div>

```sql
SELECT TOP 3 c.Name, k.Name AS Country, SUM(o.Total) AS Revenue
FROM dbo.Customers c
JOIN dbo.Orders o ON o.CustomerId = c.Id
LEFT JOIN dbo.Countries k ON k.Id = c.CountryId
WHERE o.OrderDate >= '20260101'
GROUP BY c.Name, k.Name
ORDER BY Revenue DESC;
```

<div dir="rtl" markdown="1">

#### Oracle

نام‌ها با حروف بزرگ‌اند (بدون نقل‌قول، پس هر حالتی کار می‌کند)، نام مستعار جدول `AS` نمی‌گیرد و سطرها با `FETCH FIRST` محدود می‌شوند:

</div>

```sql
SELECT c.NAME, k.NAME AS COUNTRY, SUM(o.TOTAL) AS REVENUE
FROM CUSTOMERS c
JOIN ORDERS o ON o.CUSTOMER_ID = c.ID
LEFT JOIN COUNTRIES k ON k.ID = c.COUNTRY_ID
WHERE o.ORDER_DATE >= DATE '2026-01-01'
GROUP BY c.NAME, k.NAME
ORDER BY REVENUE DESC
FETCH FIRST 3 ROWS ONLY;
```

<div dir="rtl" markdown="1">

#### MySQL / MariaDB

وقتی schema همان پایگاه است، مثل PostgreSQL:

</div>

```sql
SELECT c.name, k.name AS country, SUM(o.total) AS revenue
FROM shop.customers c
JOIN shop.orders o ON o.customer_id = c.id
LEFT JOIN shop.countries k ON k.id = c.country_id
WHERE o.order_date >= DATE '2026-01-01'
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

<div dir="rtl" markdown="1">

#### SQLite

لیترال `DATE '…'` وجود ندارد؛ تاریخ‌ها متن با قالب ISO‌اند که درست مقایسه می‌شود:

</div>

```sql
SELECT c.name, k.name AS country, SUM(o.total) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id
LEFT JOIN countries k ON k.id = c.country_id
WHERE o.order_date >= '2026-01-01'
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

<div dir="rtl" markdown="1">

#### ClickHouse

تاریخ‌ها نوع‌دارند، پس لیترال را تبدیل کنید؛ بقیه آشناست:

</div>

```sql
SELECT c.name, k.name AS country, sum(o.total) AS revenue
FROM shop.customers AS c
INNER JOIN shop.orders AS o ON o.customer_id = c.id
LEFT JOIN shop.countries AS k ON k.id = c.country_id
WHERE o.order_date >= toDateTime('2026-01-01 00:00:00', 'UTC')
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

<div dir="rtl" markdown="1">

joinهای ClickHouse جدول کوچک‌تر را در سمت راست ترجیح می‌دهند ([فصل ۱۵](15-oltp-vs-olap-columnar.md))؛ اینجا `countries` کوچک‌ترین است.

#### Snowflake (فقط بر پایهٔ مستندات)

نام‌ها با حروف بزرگ‌اند؛ ستون زمان `TIMESTAMP_NTZ` است و لیترال رشته‌ای ضمناً تبدیل می‌شود:

</div>

```sql
SELECT c.NAME, k.NAME AS COUNTRY, SUM(o.TOTAL) AS REVENUE
FROM SHOP.PUBLIC.CUSTOMERS c
JOIN SHOP.PUBLIC.ORDERS o ON o.CUSTOMER_ID = c.ID
LEFT JOIN SHOP.PUBLIC.COUNTRIES k ON k.ID = c.COUNTRY_ID
WHERE o.ORDER_DATE >= '2026-01-01'
GROUP BY c.NAME, k.NAME
ORDER BY REVENUE DESC
LIMIT 3;
```

<div dir="rtl" markdown="1">

#### Cassandra (CQL)

CQL join و `GROUP BY` بین پارتیشن‌ها ندارد، پس این پرس‌وجو دقیقاً اجرا نمی‌شود. فروشگاه Cassandra به سبک «یک جدول برای هر پرس‌وجو» مدل شده ([فصل ۱۶](16-nosql-families.md)). می‌توانید جمع یک مشتری را با خواندن یک پارتیشن بگیرید:

</div>

```sql
SELECT sum(total) AS revenue
FROM shop.orders_by_customer
WHERE customer_id = 4;      -- Dora: 254.25
```

<div dir="rtl" markdown="1">

رتبه‌بندی همهٔ مشتری‌ها در برنامه انجام می‌شود (جمع هر مشتری را بخوانید) یا در جدول خلاصهٔ از پیش محاسبه‌شده‌ای که با رسیدن سفارش‌ها نگه می‌دارید. این تفاوت قابلیت است، نه املا.

## ۳. غواصی عمیق (پیشرفته)

**چرا ابزار برای هر گویش lexer می‌خواهد.** متن `SELECT 'C:\temp'; SELECT 2;` را در نظر بگیرید. در PostgreSQL رشتهٔ اول `C:\temp` است و دو دستور داریم. در MySQL `\t` درون نقل‌قول escape یک tab است، که اینجا بی‌ضرر است، اما `'It\'s'` نکته را نشان می‌دهد: موتور یک رشتهٔ `It's` می‌بیند، در حالی که PostgreSQL رشته را در نقل‌قول دوم می‌بندد و بعد شکست می‌خورد. بدنه‌های `$$` (بدنهٔ تابعی که `;` دارد)، کامنت‌های تو‌در‌تو، کامنت‌های `#` و `DELIMITER` را اضافه کنید، آن‌گاه شکستن اسکریپت در نقطه‌ویرگول‌ها اساساً غلط است. برای همین `DialectInfo` ویژگی‌های lexer را عرضه می‌کند (`BacktickIdentifiers`، `HashLineComments`، `BackslashStringEscapes`، `DollarQuotedStrings`، `SlashLineComments`، `NestedBlockComments`) و tokenizer آن‌ها را می‌خواند به‌جای اینکه روی نام موتور شاخه بزند: «گویش تازه هرگز tokenizer را ویرایش نمی‌کند» (`DialectInfo.cs:5-7`).

**حروف، collation و مقایسه.** سه تنظیم مستقل تعیین می‌کنند `'a' = 'A'` هست یا نه: قاعدهٔ تبدیل شناسه در ۲٫۲ (برای نام‌ها)، **collation** (برای مقدارهای متنی) و نوع داده. collation پیش‌فرض SQL Server به حروف و لهجه حساس نیست؛ پیش‌فرض PostgreSQL حساس به حروف است؛ collationهای پیش‌فرض `utf8mb4` در MySQL به حروف حساس نیستند؛ SQLite مقدارها را به‌طور پیش‌فرض حساس به حروف مقایسه می‌کند (`BINARY`) مگر ستون `COLLATE NOCASE` اعلام کند؛ Oracle حساس به حروف است مگر `NLS_COMP`/`NLS_SORT` تنظیم شده باشند. `WHERE name = 'alice'` که در SQL Server و MySQL Alice را پیدا می‌کند در PostgreSQL، Oracle و SQLite چیزی پیدا نمی‌کند. مقایسه‌ها را آزمایش کنید، نه فرض‌ها را.

**تبدیل ضمنی.** وقتی نوع‌ها فرق دارند، موتورها با قاعده‌های متفاوت تبدیل می‌کنند. SQL Server بر اساس *اولویت نوع داده* تبدیل می‌کند (ستون `VARCHAR` که با پارامتر `NVARCHAR` مقایسه شود بالا برده می‌شود و می‌تواند نمایه را بی‌اثر کند؛ [فصل ۱۳](13-performance-tuning.md)). PostgreSQL سخت‌گیر است: `integer = text` را به‌جای حدس زدن رد می‌کند. MySQL سهل‌گیر است و رشته را بی‌صدا به عدد تبدیل می‌کند (`'abc' = 0` درست است). SQLite بر اساس کلاس ذخیره‌سازی مقایسه می‌کند. Oracle رشته را با تنظیم‌های نشست (`NLS_DATE_FORMAT`) به عدد یا تاریخ تبدیل می‌کند، که می‌تواند اسکریپتی را روی یک ماشین موفق و روی دیگری ناموفق کند. `CAST` صریح و لیترال‌های نوع‌دار (`DATE '…'`) را ترجیح دهید.

**منطقهٔ زمانی.** `timestamptz` در PostgreSQL یک لحظه (UTC) ذخیره می‌کند و هنگام نمایش تبدیل می‌کند؛ `DATETIME2` در SQL Server منطقه ندارد و `DATETIMEOFFSET` دارد؛ Oracle سه نوع `TIMESTAMP`، `TIMESTAMP WITH TIME ZONE` و `WITH LOCAL TIME ZONE` دارد؛ `TIMESTAMP` در MySQL مبتنی بر UTC است و `DATETIME` نه؛ Snowflake سه نوع (`NTZ`، `LTZ`، `TZ`) دارد؛ ClickHouse منطقه را در نوع ستون ذخیره می‌کند (`DateTime('UTC')`). قاعدهٔ عملی همه‌جا یکی است: لحظه‌ها را با نوعی بی‌ابهام در UTC ذخیره کنید و در مرزها تبدیل کنید.

**راهبرد قابل‌حمل بودن.** سه سطح در دسترس است: به هستهٔ مشترک بنویسید (کمترین غافلگیری، کمترین قدرت)، از لایهٔ انتزاعی استفاده کنید که برای هر گویش SQL تولید می‌کند (ORMها و query builderها؛ املا را پنهان می‌کنند نه معناشناسی را)، یا SQL ویژهٔ هر گویش را پشت یک واسط بنویسید و هرکدام را آزمایش کنید (کاری که IDE پایگاه داده می‌کند). هرچه انتخاب کنید، آزمونی انطباقی نگه دارید که همین سناریوها را روی هر موتور اجرا کند: Rowlit برای providerهای رابطه‌ای مجموعهٔ مشترک دارد ([فصل ۲۳ بخش II](../part2/23-testing-and-qa.md)).

## ۴. در هر موتور

ویژگی‌های lexer در `DialectInfo` در یک جدول (علامت «بله» یعنی ویژگی برای گویش درست است؛ منبع: `DialectInfo.cs:35-51`):

| ویژگی | T-SQL | PL/SQL | PgSQL | MySQL | SQLite | ClickHouse | Snowflake | CQL | DuckDB |
|---|---|---|---|---|---|---|---|---|---|
| کامنت تو‌در‌توی `/* /* */ */` | بله | | بله | | | | | | بله |
| شناسهٔ `` `name` `` | | | | بله | بله | بله | | | |
| کامنت خطی `# …` | | | | بله | | بله | | | |
| escape با بک‌اسلش در `'…'` | | | | بله | | بله | بله | | |
| رشتهٔ `$$ … $$` | | | بله | | | | بله | بله | بله |
| کامنت خطی `// …` | | | | | | | بله | بله | |
| سطح پایگاه دارد (`HasDatabases`) | بله | | بله | | | | بله | | |
| schema همان پایگاه است (`SchemaIsDatabase`) | | بله | | بله | | بله | | بله | |

بقیهٔ این فصل در کلاس‌های هر provider است که در جدول‌ها ذکر شد.

## ۵. تمرین‌ها

1. **پرس‌وجوی صفحه‌بندی را ترجمه کنید.** `SELECT TOP 5 OrderDate, Total FROM dbo.Orders ORDER BY Total DESC` T-SQL است. آن را برای PostgreSQL، Oracle (12c یا بعد)، MySQL و Cassandra بنویسید. برای کدام ناممکن است و چرا؟
2. **گویش را تشخیص دهید.** این دستور برای PostgreSQL نوشته شده و روی SQL Server شکست می‌خورد: `SELECT name || ' <' || email || '>' AS label FROM customers WHERE order_date > now() - interval '7 days' LIMIT 10`. هر ساختاری که باید عوض شود را فهرست کنید و نسخهٔ SQL Server را بنویسید (از `dbo.Customers` استفاده کنید و ستونی به نام `LastOrder` فرض کنید).
3. **جدول نقل‌قول‌شده.** در Oracle اجرا کردید `CREATE TABLE "Orders" (id NUMBER)`. فردا `SELECT * FROM orders` خطای `ORA-00942` می‌دهد. توضیح دهید و دو راه برای کار کردن پرس‌وجوها نشان دهید. آیا در SQL Server هم همین می‌شود؟
4. **رشتهٔ خالی.** `''` را در ستون `VARCHAR` تهی‌پذیر در PostgreSQL و Oracle درج می‌کنید و سپس `WHERE col IS NULL` اجرا می‌کنید. هرکدام چه برمی‌گردانند و چرا؟ این روی نمایهٔ یکتا روی ستون چه اثری دارد؟
5. **کدام جداکننده؟** اسکریپتی خط‌های `GO`، `/` و `DELIMITER $$` دارد. هر کدام به کدام موتور تعلق دارد و اگر کل اسکریپت را به‌صورت یک فرمان از راه درایور بفرستید چه می‌شود؟
6. **فراداده را پیدا کنید.** پرس‌وجویی بنویسید که *نام همهٔ جدول‌های shop* را برای SQLite، ClickHouse و Cassandra فهرست کند و توضیح دهید شکل Cassandra چه فرقی با دو تای دیگر دارد.

## پاسخ‌ها

پاسخ‌ها در [فصل ۱۸](18-exercise-answers.md#chapter-17) گردآوری می‌شوند و اینجا هم تکرار شده‌اند.

</div>

<details>
<summary>نمایش پاسخ‌ها</summary>

<div dir="rtl" markdown="1">

1. PostgreSQL: `SELECT order_date, total FROM public.orders ORDER BY total DESC LIMIT 5;` (ستون‌های PostgreSQL آزمایشگاه lower_snake_case اند). Oracle: `SELECT ORDER_DATE, TOTAL FROM ORDERS ORDER BY TOTAL DESC FETCH FIRST 5 ROWS ONLY;`. MySQL: `SELECT order_date, total FROM orders ORDER BY total DESC LIMIT 5;`. Cassandra همان‌طور که نوشته شده نمی‌تواند: `ORDER BY` فقط روی ستون‌های خوشه‌بندی درون یک پارتیشن کار می‌کند و `orders` کلید پارتیشن `id` دارد، پس «۵ برتر بر اساس total در همهٔ سفارش‌ها» طراحی جدول متفاوتی می‌خواهد (مثلاً جدولی پارتیشن‌بندی‌شده با یک bucket و `total` به‌عنوان کلید خوشه‌بندی) یا مرتب‌سازی در برنامه.
2. تغییرها: `||` به `+` یا `CONCAT(...)` تبدیل می‌شود؛ `now()` به `GETDATE()` یا `SYSDATETIME()`؛ `interval '7 days'` به `DATEADD(day, -7, GETDATE())`؛ `LIMIT 10` به `TOP 10`. نتیجه: `SELECT TOP 10 CONCAT(Name, ' <', Email, '>') AS label FROM dbo.Customers WHERE LastOrder > DATEADD(day, -7, GETDATE());` (`CONCAT` برخلاف `+` ایمیل NULL را رشتهٔ خالی می‌گیرد.)
3. `"Orders"` نقل‌قول‌شده با حروف مخلوط ذخیره شده. `orders` بدون نقل‌قول به `ORDERS` تبدیل می‌شود که وجود ندارد. راه‌حل: همیشه `"Orders"` (نقل‌قول‌شده) بنویسید یا جدول را بدون نقل‌قول به‌صورت `ORDERS` بسازید. در SQL Server هم `CREATE TABLE [Orders]` و هم `SELECT * FROM orders` با collation پیش‌فرض (حساس‌نبودن به حروف) کار می‌کنند، پس این رخ نمی‌دهد (روی collation حساس به حروف ممکن است).
4. PostgreSQL سطری برنمی‌گرداند: `''` یک مقدار است نه NULL. Oracle سطر را برمی‌گرداند: `''` همان NULL است. در نمایهٔ یکتا، Oracle چند `''` را می‌پذیرد (چند NULL در نمایهٔ یکتای تک‌ستونی تعارض ندارند)، در حالی که PostgreSQL دو `''` را تکراری می‌داند و دومی را رد می‌کند.
5. `GO`: SQL Server (ابزارهای کلاینت مانند SSMS/sqlcmd). `/`: Oracle (SQL\*Plus). `DELIMITER $$`: MySQL/MariaDB (کلاینت `mysql`). اگر به‌صورت یک فرمان فرستاده شود، هر کدام از این توکن‌ها خطای نحوی است چون هیچ‌کدام دستور سرور نیستند؛ ابزار باید خودش اسکریپت را بشکند.
6. SQLite: `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\';`. ClickHouse: `SELECT name FROM system.tables WHERE database = 'shop';`. Cassandra: `SELECT table_name FROM system_schema.tables WHERE keyspace_name = 'shop';`. کاتالوگ Cassandra خودش مجموعه‌ای از جدول‌های CQL است که بر اساس keyspace پارتیشن‌بندی شده‌اند، پس فیلتر روی کلید پارتیشن (`keyspace_name`) است، همان‌طور که باید.

</div>

</details>

<div dir="rtl" markdown="1">

## فصل‌های مرتبط

- [فصل ۳: SQL I](03-sql-basics.md) و [فصل ۴: SQL II](04-sql-advanced.md): هستهٔ مشترکی که این فصل تغییرش می‌دهد.
- [فصل ۵: مدل‌سازی و نرمال‌سازی](05-modelling-and-normalisation.md): نوع داده، کلید و قید.
- [فصل ۸: پردازش پرس‌وجو](08-query-processing.md): خواندن طرح‌های ۲٫۱۲.
- [فصل ۹: تراکنش‌ها و ایزولاسیون](09-transactions-and-isolation.md): autocommit، savepoint، سطح‌های ایزولاسیون.
- [فصل ۱۳: تنظیم کارایی](13-performance-tuning.md): تبدیل ضمنی و صفحه‌بندی.
- [فصل ۱۴: امنیت](14-security.md): جانگهدار و نقل‌قول شناسه به‌عنوان دفاع در برابر تزریق.
- [فصل ۱۶: خانواده‌های NoSQL](16-nosql-families.md): مدل داده Cassandra.
- بخش II: [فصل ۹ providerهای رابطه‌ای](../part2/09-relational-providers.md) (جایی که Rowlit قاعده‌های این فصل را کد کرده است).

## اصطلاحات واژه‌نامه که در این فصل معرفی شدند

[dialect](../glossary.md#dialect)، [quoting](../glossary.md#quoting)، [case folding](../glossary.md#case-folding)، [batch separator](../glossary.md#batch-separator)، [GO](../glossary.md#go)، [DELIMITER](../glossary.md#delimiter)، [bind-variable styles](../glossary.md#bind-variable)، [T-SQL](../glossary.md#t-sql)، [PL/SQL](../glossary.md#pl-sql)، [PL/pgSQL](../glossary.md#pl-pgsql)، [CQL](../glossary.md#cql)، [DuckDB SQL](../glossary.md#duckdb-sql)، [auto_increment](../glossary.md#auto-increment)، [serial](../glossary.md#serial)، [identity column](../glossary.md#identity-column)، [keyspace](../glossary.md#keyspace)، [UDT](../glossary.md#udt)، [warehouse](../glossary.md#warehouse)، [search_path](../glossary.md#search-path)، [information_schema](../glossary.md#information-schema)، [sys catalog views](../glossary.md#sys-catalog-views)، [pg_catalog](../glossary.md#pg-catalog)، [ALL_* views](../glossary.md#all-views)، [sqlite_master](../glossary.md#sqlite-master)، [system.* tables](../glossary.md#system-tables)، [system_schema](../glossary.md#system-schema).

</div>
