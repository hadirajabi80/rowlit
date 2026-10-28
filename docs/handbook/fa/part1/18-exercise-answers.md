<div dir="rtl">

# 18. پاسخ تمرین‌ها و راه‌اندازی آزمایشگاه

> **زبان:** [English](../../en/part1/18-exercise-answers.md) | فارسی | **قبلی:** [17. مقایسهٔ هشت گویش رابطه‌ای](17-dialect-comparison.md)
> **سطح:** L1 مبتدی | **بخش:** I
> **در یک جمله:** چگونه سرورهای نمونهٔ `shop` را روی دستگاه خودتان راه بیندازید، به آن‌ها وصل شوید، درستی داده‌ها را بررسی کنید، و پاسخ‌های کامل تمرین‌های همهٔ فصل‌های بخش اول.
> **چه می‌آموزید:**
> - سرورهای Docker که داده‌های `shop` را نگه می‌دارند چگونه راه‌اندازی، متوقف و بازنشانی می‌شوند
> - نشانی، پایگاه داده و اعتبارنامهٔ هر سرور، و یک کلاینت خط فرمان برای هر کدام
> - چگونه مطمئن شوید داده همان است که کتاب انتظار دارد
> - پاسخ‌ها، به تفکیک فصل
>
> **پیش‌نیازها:** برای آزمایشگاه هیچ؛ تمرین را پیش از پاسخش بخوانید.
> **وضعیت این فایل:** بخش‌های I-01 تا I-05 کامل‌اند. بخش‌های I-06 تا I-17 فقط عنوان‌اند و بسته‌های نگارشی آن فصل‌ها پرشان می‌کنند.
> برچسب‌های نمودارها به انگلیسی نگه داشته شده‌اند تا در GitHub درست نمایش داده شوند.

## 1. ایده (مبتدی)

بخش اول با مثال درس می‌دهد و مثال‌ها از یک پایگاه داده کوچک به نام `shop` استفاده می‌کنند. برای دنبال‌کردنشان به پایگاه داده‌ای نیاز دارید که پرس‌وجوها را رویش اجرا کنید. لازم نیست چیزی را دائمی نصب کنید: مخزن Rowlit یک فایل Docker Compose دارد که سرورهای آمادهٔ پایگاه داده را دانلود می‌کند، در هر کدام `shop` را می‌سازد، و هر وقت بخواهید همه‌چیز را دور می‌ریزد. اگر فقط SQLite دارید، باز هم می‌توانید بیشتر کتاب را اجرا کنید (بخش 2.1).

پیش از خواندن پاسخ‌ها تمرین‌ها را خودتان انجام بدهید. پاسخ غلطی که خودتان به آن رسیده‌اید بیشتر از پاسخ درستی که خوانده‌اید یاد می‌دهد.

## 2. آزمایشگاه

### 2.1 ارزان‌ترین گزینه: SQLite

فایل `engine/tests/fixtures/shop.sqlite` پایگاه داده `shop` برای SQLite است: جدول‌هایی با نام snake_case به نام‌های `countries`، `customers`، `orders`، `products`، `order_lines` و نمای `customer_orders`. این پایگاه از همان داده‌ای ساخته شده که seedهای دیگر دارند (`engine/tests/DbStudio.Providers.Conformance/ShopSchema.cs`). آن را با Rowlit، با پوستهٔ `sqlite3` یا با هر نمایشگر SQLite باز کنید. اگر قصد تغییر داده دارید، روی یک کپی از فایل کار کنید. کلیدهای خارجی فقط وقتی اعمال می‌شوند که اتصال `PRAGMA foreign_keys = ON;` را اجرا کرده باشد.

پایگاه داده نمونهٔ داخلی Rowlit (File، سپس باز کردن پایگاه داده نمونه) یک پایگاه داده SQLite دیگر و بزرگ‌تر است (300 مشتری، 1500 سفارش، نام‌ها به سبک PascalCase). تمرین‌های این کتاب از آن استفاده نمی‌کنند.

### 2.2 همهٔ موتورها: Docker Compose

به Docker Desktop (یا Docker Engine روی لینوکس) در حال اجرا نیاز دارید. از ریشهٔ مخزن:

</div>

```powershell
docker compose -f engine/tests/docker/compose.yml up -d
docker compose -f engine/tests/docker/compose.yml ps
```

<div dir="rtl">

پروژهٔ compose `dbstudio-it` نام دارد (`name:` در بالای `compose.yml`). بدون هیچ profile، دستور `up -d` این سرویس‌ها را بالا می‌آورد: `mssql` (به‌علاوهٔ `mssql-seed` که یک‌بار اجرا می‌شود)، `oracle`، `postgres`، `redis` (به‌علاوهٔ `redis-seed`)، `mongo` (به‌علاوهٔ `mongo-seed`)، `mysql`، `mariadb` و `clickhouse`. (README در `engine/tests/docker/` فهرست کوتاه‌تری ذکر می‌کند؛ مرجع، فایل compose است.) بقیه با profile اضافه می‌شوند:

</div>

```powershell
docker compose -f engine/tests/docker/compose.yml --profile cassandra up -d     # Cassandra 5 + seed
docker compose -f engine/tests/docker/compose.yml --profile search up -d        # Elasticsearch + seed
docker compose -f engine/tests/docker/compose.yml --profile kafka up -d         # Kafka + Schema Registry
docker compose -f engine/tests/docker/compose.yml --profile cluster up -d       # Redis cluster
```

<div dir="rtl">

همهٔ آن‌ها را لازم ندارید. برای فصل‌های 1 تا 5 بخش اول، PostgreSQL، SQL Server و MySQL کافی‌اند. با آوردن نام سرویس‌ها فقط همان‌هایی را که نیاز دارید بالا بیاورید: `docker compose -f engine/tests/docker/compose.yml up -d postgres mssql mssql-seed mysql`.

منتظر سرورها بمانید. SQL Server در حدود 15 ثانیه healthy گزارش می‌شود و سپس کانتینر seed دادهٔ `shop` را بار می‌کند؛ Oracle در نخستین راه‌اندازی یک تا دو دقیقه طول می‌کشد چون پایگاه داده را می‌سازد و seed را از `/container-entrypoint-initdb.d` اجرا می‌کند. وقتی سروری آماده باشد، `docker compose ... ps` وضعیت `healthy` را نشان می‌دهد. نخستین راه‌اندازی imageها را دانلود می‌کند (SQL Server حدود 1.5 GB و Oracle حدود 1 GB، بر پایهٔ `engine/tests/docker/README.md`).

#### نشانی‌ها و اعتبارنامه‌ها

این‌ها از `engine/tests/docker/README.md` و `compose.yml` گرفته شده‌اند. اعتبارنامه‌های توسعهٔ دورریختنی برای کانتینرهای محلی‌اند؛ هیچ جای دیگری از آن‌ها استفاده نکنید.

| موتور | میزبان و پورت | پایگاه داده / سرویس | کاربر و گذرواژه | فایل seed |
|---|---|---|---|---|
| PostgreSQL 17 | `localhost:15432` | پایگاه داده `shop` | `shop` / `shop` | `seed-postgres.sql` |
| SQL Server 2022 | `localhost,14333` | پایگاه داده `shop` | `sa` / `DbStudio_Dev_2026!` | `seed-mssql.sql` |
| Oracle 23 Free | `localhost:15211` | سرویس `FREEPDB1`، اسکیما `SHOP` | `shop` / `shop`؛ مدیر `SYSTEM` / `DbStudioDev2026` | `seed-oracle.sql` |
| MySQL 8.4 | `localhost:13306` | پایگاه داده `shop` | `shop` / `shop` | `seed-mysql.sql` |
| MariaDB 11 | `localhost:13307` | پایگاه داده `shop` | `shop` / `shop` | `seed-mysql.sql` + `seed-mariadb.sql` |
| ClickHouse 24.8 | HTTP روی `localhost:18123`، native روی `localhost:19000` | پایگاه داده `shop` | `shop` / `shop` | `seed-clickhouse.sql` |
| Cassandra 5 (profile) | `localhost:19042` | keyspace `shop` | ندارد | `seed-cassandra.cql` |
| Snowflake | حساب خودتان | `SHOP.PUBLIC` | مال خودتان | `seed-snowflake.sql`، به‌صورت دستی در worksheet اجرا می‌شود |
| Redis Stack 7.4 | `localhost:16379` | | ندارد | `seed-redis.sh` |
| MongoDB 7 | `mongodb://localhost:27018/?directConnection=true` | | ندارد | `seed-mongo.js` |
| Kafka 3.8 (profile) | `localhost:19092` | | ندارد | `seed-kafka.sh` |
| Elasticsearch 8.15 (profile) | `http://localhost:19200` | | ندارد | `seed-elasticsearch.sh` |

پورت‌های میزبان سمت چپِ نگاشت پورت‌ها در `compose.yml` هستند؛ عمداً غیرمعمول انتخاب شده‌اند تا با سرورهایی که از قبل اجرا می‌کنید تداخل نکنند. اگر پورتی مشغول بود، پیش از `docker compose up` متغیر محیطی متناظر را تنظیم کنید (مثلاً `PG_PORT`).

#### اتصال

هر کلاینتی کار می‌کند: Rowlit (New connection، انتخاب provider، واردکردن مقدارهای بالا؛ [بخش دوم، فصل 8](../part2/08-connections-sessions-execution.md) را ببینید)، یا یک کلاینت خط فرمان که *داخل* کانتینر اجرا می‌شود تا چیزی نصب نکنید:

</div>

```powershell
docker compose -f engine/tests/docker/compose.yml exec postgres psql -U shop -d shop
docker compose -f engine/tests/docker/compose.yml exec mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "DbStudio_Dev_2026!" -C -d shop
docker compose -f engine/tests/docker/compose.yml exec mysql mysql -ushop -pshop shop
docker compose -f engine/tests/docker/compose.yml exec mariadb mariadb -ushop -pshop shop
docker compose -f engine/tests/docker/compose.yml exec clickhouse clickhouse-client --user shop --password shop --database shop
docker compose -f engine/tests/docker/compose.yml exec oracle sqlplus shop/shop@//localhost:1521/FREEPDB1
docker compose -f engine/tests/docker/compose.yml --profile cassandra exec cassandra cqlsh
```

<div dir="rtl">

مسیر `sqlcmd` همانی است که بررسی سلامت خود پروژه به کار می‌برد (`compose.yml`، سرویس `mssql`). نام ابزارها در imageهای دیگر از imageهای بالادستی پیروی می‌کند؛ اگر در نسخهٔ image شما ابزاری نبود، به‌جایش از Rowlit یا کلاینتی روی دستگاه خودتان استفاده کنید (برای همهٔ برچسب‌های image راستی‌آزمایی نشده است).

#### بررسی داده

این را در هر موتور اجرا کنید. پنج عدد باید یکی باشند؛ اگر بودند، هر مثال کتاب همان نتیجه‌ای را می‌دهد که نشان داده شده.

</div>

```sql
SELECT (SELECT count(*) FROM countries)   AS countries,    -- 3
       (SELECT count(*) FROM customers)   AS customers,    -- 5
       (SELECT count(*) FROM products)    AS products,     -- 4
       (SELECT count(*) FROM orders)      AS orders,       -- 6
       (SELECT count(*) FROM order_lines) AS order_lines;  -- 7
```

<div dir="rtl">

در SQL Server نام جدول‌ها `Countries`، `Customers` و مانند آن است (PascalCase) و نام‌های Oracle با حروف بزرگ است (`CUSTOMERS`)؛ Oracle پیش از نسخهٔ 23 به `FROM dual` هم نیاز دارد و تاریخ‌های seed را به‌صورت `DATE` در نظر می‌گیرد. نام جدول و ستون از موتوری به موتور دیگر فرق می‌کند، چنان‌که در [فصل I-17](17-dialect-comparison.md) آمده است؛ کتاب مثال‌ها را با نام‌های snake_case در PostgreSQL، MySQL و SQLite می‌نویسد و هر جا نامی فرق کند می‌گوید.

#### بازنشانی و توقف

seedها خودتوان‌اند (idempotent). برای برگرداندن داده پس از تغییر، seed را دوباره اجرا کنید: در PostgreSQL فایل را به `psql` بدهید (`docker compose ... exec -T postgres psql -U shop -d shop < engine/tests/docker/seed-postgres.sql` در یک پوستهٔ POSIX) یا فایل را از Rowlit اجرا کنید؛ SQL Server و Oracle هم به همین ترتیب می‌توانند seedشان را دوباره اجرا کنند (`sqlcmd -i`، SQL*Plus). مطمئن‌ترین بازنشانی این است که کانتینرها و volumeها را حذف کنید و دوباره شروع کنید:

</div>

```powershell
docker compose -f engine/tests/docker/compose.yml down -v      # removes containers AND data volumes
docker compose -f engine/tests/docker/compose.yml up -d
```

<div dir="rtl">

`down` بدون `-v` داده را نگه می‌دارد. بعضی seedها فقط وقتی اجرا می‌شوند که دایرکتوری داده برای اولین بار ساخته شود (`docker-entrypoint-initdb.d` در PostgreSQL)، و به همین دلیل بازنشانی یعنی `down -v`.

#### رفع اشکال

| نشانه | علت محتمل و راه‌حل |
|---|---|
| `failed to connect to the docker API` | Docker Desktop اجرا نشده است. آن را راه بیندازید و صبر کنید تا وضعیت در حال اجرا را نشان بدهد. |
| `port is already allocated` | برنامهٔ دیگری از پورت میزبان استفاده می‌کند. آن را متوقف کنید یا پورت را با متغیری که در `compose.yml` آمده تغییر بدهید (`PG_PORT`، `MSSQL_PORT` و مانند آن). |
| Login failed for `sa` | گذرواژه `!` دارد؛ آن را در پوستهٔ خودتان نقل‌قول کنید. در PowerShell همان‌طور که نشان داده شد از گیومهٔ دوتایی استفاده کنید. |
| پایگاه داده `shop` در SQL Server وجود ندارد | `mssql-seed` هنوز تمام نشده یا شکست خورده است؛ `docker compose ... logs mssql-seed` را اجرا کنید. |
| Oracle یک دقیقه اتصال را رد می‌کند | نخستین راه‌اندازی پایگاه داده را می‌سازد؛ تا `healthy` شدن صبر کنید. |
| نتیجهٔ یک پرس‌وجو با کتاب فرق دارد | کسی داده را تغییر داده است. بازنشانی کنید (بالا را ببینید). `ORDER BY` را هم بررسی کنید: بدون آن ترتیب سطرها تضمین نمی‌شود. |
| فشار حافظه | فقط سرورهایی را بالا بیاورید که لازم دارید (نامشان را در دستور `up` بیاورید). Oracle و SQL Server بیشترین RAM را می‌خواهند. |

## 3. پاسخ‌ها

هر پاسخ نتیجه‌ای را که باید ببینید می‌دهد. جایی که تمرینی چند راه‌حل درست دارد فقط یکی نشان داده شده است. «خروجی تصویری» (illustrative output) یعنی سطرها از داده‌های seed محاسبه شده‌اند؛ نتیجه‌های SQLite با اجرای خود دستورها به دست آمده‌اند.

<a id="i-01"></a>
<a id="chapter-1"></a>
### I-01: پایگاه داده چیست

**1. توکار یا سرور؟**
(الف) پایگاه داده مخاطبان یک برنامهٔ تلفن تقریباً همیشه توکار (SQLite) است. کپی‌کردن فایل در حالی که برنامه مشغول نوشتن است ممکن است کپی‌ای بدهد که از درون ناسازگار است؛ راه‌های امن، API پشتیبان‌گیری SQLite است یا کپی‌کردن در حالی که برنامه بسته است. دستگاه دوم نمی‌تواند همزمان از همان فایل استفاده کند.
(ب) پایگاه داده یک فروشگاه وب کلاینت/سرور است. کپی‌کردن فایل‌های داده در حالی که سرور در حال اجراست صفحه‌های ناقص‌نوشته‌شده (torn pages) و کپی‌ای می‌دهد که بازیابی نمی‌شود؛ از ابزار پشتیبان‌گیری خود DBMS استفاده کنید ([فصل I-12](12-backup-replication-ha.md)).
(پ) فایل حافظهٔ نهان یک ویرایشگر دسکتاپ توکار است (ویرایشگر کتابخانه را به خود پیوند می‌دهد). همان هشدار کپی که در (الف) گفته شد.
(ت) انبار دادهٔ ابری یک سرویس کلاینت/سرور است. فایلی برای کپی‌کردن در اختیار شما نیست؛ داده را از طریق خود سرویس خروجی می‌گیرید یا به اشتراک می‌گذارید.

**2. فایل چه کاری نمی‌تواند بکند.** چهار پاسخ ممکن:
- دو نفر همزمان ذخیره می‌کنند و یک تغییر از بین می‌رود. *همروندی* (تراکنش‌ها، قفل‌ها یا نسخه‌ها).
- دستگاه وسط ذخیره‌سازی می‌میرد و فایل ناقص می‌ماند. *دوام* (لاگ پیش‌نویسی یا write-ahead log).
- کسی برای قیمت `abc` تایپ می‌کند یا سفارشی برای مشتری ناموجود ثبت می‌کند. *کنترل* (نوع‌ها، قیدها، کلیدهای خارجی).
- کارمند پشتیبانی که باید سفارش‌ها را ببیند ایمیل همه را هم می‌تواند بخواند. *کنترل* (امتیازها).
- پیداکردن سفارش‌های یک مشتری هر بار کل فایل را می‌خواند. *زبان پرس‌وجو* و نمایه‌های پشت آن.

**3. ردگیری یک پرس‌وجو.** برنامه (متن SQL را می‌سازد)، درایور (آن را روی پروتکل می‌فرستد)، لایهٔ پروتکل (احراز هویت می‌کند و نشست را نگه می‌دارد)، تجزیه‌گر و بهینه‌ساز (متن را می‌خوانند و طرح انتخاب می‌کنند؛ اینجا پویش `customers`)، اجراکننده (سطرها را می‌شمارد)، موتور ذخیره‌سازی و استخر بافر (buffer cache) (صفحه‌ها را تأمین می‌کنند)، فایل‌های داده (صفحه‌ها را نگه می‌دارند). اجراکننده عدد 5 را تولید می‌کند، لایهٔ پروتکل آن را برمی‌گرداند و درایور آن را به‌صورت نتیجه‌ای تک‌سطری به برنامه تحویل می‌دهد. لایه‌ای که عدد را برای کلاینت می‌فرستد لایهٔ پروتکل است.

**4. نام‌ها.**
(الف) PostgreSQL: `sales.invoices` (schema.table)؛ وقتی `shop` پایگاه داده‌ای است که به آن وصل هستید، `shop.sales.invoices` هم پذیرفته می‌شود.
(ب) SQL Server: `Sales.Invoices` یا `shop.Sales.Invoices`؛ نام سه‌بخشی از اتصالی که پایگاه داده دیگری در همان نمونه را به کار می‌برد هم کار می‌کند.
(پ) Oracle: `sales.invoices` (user.table)، به شرط آنکه به کاربر متصل دسترسی داده شده باشد.
(ت) MySQL: `sales.invoices` (database.table).
هر چهار نام کامل‌اند، پس هیچ‌کدام لازم ندارند `sales` از پیش انتخاب شده باشد. فقط PostgreSQL نمی‌تواند از همان اتصال به جدولی در *پایگاه داده‌ای دیگر* برسد.

**5. دست به کار.** `SELECT count(*) FROM customers;` عدد 5 را برمی‌گرداند. `sqlite_version()` نسخهٔ کتابخانهٔ SQLite شما را برمی‌گرداند (مثلاً 3.4x یا جدیدتر). لایه‌ای که وجود ندارد شبکه است: فرایند سروری و پروتکل شبکه‌ای در کار نیست، چون برنامه و DBMS یک فرایند واحدند.

<a id="i-02"></a>
<a id="chapter-2"></a>
### I-02: مدل رابطه‌ای

**1. کلیدها.** `order_id` به‌تنهایی کلید نیست: سفارش 1 دو خط دارد. `product_id` به‌تنهایی کلید نیست: محصول 2 در سفارش‌های 1 و 2 آمده است. `(order_id, product_id)` برای هر سطر یکتا و کمینه است. `(order_id, product_id, qty)` ابرکلید است اما کمینه نیست، چون با حذف `qty` کلیدی باقی می‌ماند، پس کلید کاندید نیست. برای اینکه Mouse دوبار در یک سفارش بیاید، شمارهٔ خط اضافه کنید: `PRIMARY KEY (order_id, line_no)` و `product_id` را ستون کلید خارجی معمولی نگه دارید (پایگاه داده نمونهٔ داخلی Rowlit همین کار را می‌کند).

**2. منطق سه‌مقداری.**

| عبارت | نتیجه |
|---|---|
| `NULL = NULL` | UNKNOWN |
| `NULL IS NULL` | TRUE |
| `1 <> NULL` | UNKNOWN |
| `NULL OR TRUE` | TRUE |
| `NULL AND FALSE` | FALSE |
| `NOT NULL` | UNKNOWN |
| `(1 = 1) AND (NULL = 2)` | UNKNOWN (TRUE AND UNKNOWN) |

**3. شمارش.** `count(*)` برابر 5، `count(email)` برابر 3، `count(country_id)` برابر 4 و `count(DISTINCT country_id)` برابر 3 است. `WHERE country_id <> 1` فقط Bob و Chie را برمی‌گرداند (2 سطر). غایب‌ها: Alice و Dora (درست است، کشورشان 1 است) و **Emil** که NULL بودن کشورش مقایسه را UNKNOWN می‌کند.

**4. جبر.** π<sub>name</sub>(σ<sub>total &gt; 100</sub>(customers ⋈<sub>customers.id = orders.customer_id</sub> orders)).

</div>

```sql
SELECT DISTINCT c.name
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE o.total > 100;           -- Alice, Bob, Dora
```

<div dir="rtl">

در درخت عبارت، پیوند پایین‌ترین جاست، بعد گزینش و بعد تصویر. `orders` (6 سطر) از `customers` (5 سطر) بزرگ‌تر است. بهینه‌ساز گزینش را اول اعمال می‌کند (برابر است با σ<sub>total &gt; 100</sub>(orders) که 3 سطر دارد) و بعد پیوند می‌زند؛ نتیجه یکی است و پیوند کوچک‌تر. `DISTINCT` فقط به این دلیل لازم است که مشتری‌ای با دو سفارش بزرگ دوبار ظاهر می‌شد.

**5. مدل.** یک مشتری می‌تواند چند محصول را نقد کند و یک محصول را چند مشتری می‌توانند نقد کنند: ارتباطی چندبه‌چند که با جدول رابطی مثل `order_lines` حل می‌شود و کلید اصلی‌اش جفت کلیدهای خارجی است (که «حداکثر یک‌بار» را هم اعمال می‌کند).

</div>

```sql
CREATE TABLE reviews (
  customer_id integer NOT NULL REFERENCES customers (id),
  product_id  integer NOT NULL REFERENCES products (id),
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  PRIMARY KEY (customer_id, product_id)
);
```

<div dir="rtl">

در نمادگذاری پای کلاغی (crow's foot): `CUSTOMERS ||--o{ REVIEWS` و `PRODUCTS ||--o{ REVIEWS`.

**6. مجموعه در برابر چندمجموعه.** `UNION` چهار سطر برمی‌گرداند: NULL، 1، 2، 3. پرس‌وجوی چپ `1, 2, 3, 1, NULL` و پرس‌وجوی راست `1, 2, 3` را می‌دهد؛ `UNION` تکراری‌ها را حذف می‌کند (`1` دوم و `1, 2, 3` سمت راست). `UNION ALL` تعداد 5 + 3 = 8 سطر برمی‌گرداند. NULL یک بار ظاهر می‌شود چون در ورودی یک بار آمده؛ حذف تکراری‌ها دو NULL را برابر می‌گیرد، هرچند `NULL = NULL` درست نیست.

<a id="i-03"></a>
<a id="chapter-3"></a>
### I-03: SQL I، خواندن داده

**1. فیلتر و مرتب‌سازی.**

</div>

```sql
SELECT name, email FROM customers WHERE email IS NOT NULL ORDER BY name DESC;   -- Dora, Chie, Alice  (3 rows)
SELECT name FROM customers WHERE country_id <> 1 OR country_id IS NULL;         -- Bob, Chie, Emil
```

<div dir="rtl">

`IS NULL` لازم است چون `country_id <> 1` برای Emil نامعلوم (UNKNOWN) است. در موتورهایی که پشتیبانی می‌کنند، `country_id IS DISTINCT FROM 1` هر دو را در یک گزاره انجام می‌دهد.

**2. پیوندها.**

</div>

```sql
INSERT INTO countries VALUES (4, 'Chile');
SELECT co.name, count(c.id) AS customers
FROM countries co LEFT JOIN customers c ON c.country_id = co.id
GROUP BY co.id, co.name ORDER BY co.id;
```

<div dir="rtl">

| name | customers |
|---|---|
| Germany | 2 |
| France | 1 |
| Japan | 1 |
| Chile | 0 |

`LEFT JOIN` با `countries` در سمت چپ، کشورهای بدون مشتری را نگه می‌دارد. `count(c.id)` فقط مشتری‌های جفت‌شده را می‌شمارد؛ `count(*)` سطر پرشده با NULL برای Chile را 1 می‌شمرد.

**3. گروه‌بندی.** میانگین مجموع سفارش‌ها برابر 647.40 / 6 = 107.90 است.

</div>

```sql
SELECT customer_id, sum(total) AS revenue
FROM orders GROUP BY customer_id
HAVING sum(total) > (SELECT avg(total) FROM orders)
ORDER BY customer_id;
```

<div dir="rtl">

| customer_id | revenue |
|---|---|
| 1 | 140.00 |
| 2 | 199.00 |
| 4 | 254.25 |

مقایسه `sum(total)` را درگیر می‌کند که تابع تجمیعی است، پس باید در `HAVING` باشد: `WHERE` پیش از گروه‌بندی ارزیابی می‌شود و نمی‌تواند تابع تجمیعی را ببیند. میانگین، زیرپرس‌وجوی scalar در سمت راست است. Chie (54.15) زیر آن می‌ماند.

**4. دام.**

</div>

```sql
SELECT p.name, coalesce(sum(l.qty), 0) AS units
FROM products p LEFT JOIN order_lines l ON l.product_id = p.id
GROUP BY p.id, p.name ORDER BY units DESC, p.id;
```

<div dir="rtl">

| name | units |
|---|---|
| Keyboard | 3 |
| Mouse | 2 |
| Monitor | 2 |
| Cable | 1 |

محصولی که هرگز فروخته نشده باشد، به لطف `LEFT JOIN` و `coalesce`، 0 نشان داده می‌شود. اگر `orders` را هم پیوند می‌زدید و `o.total` را جمع می‌کردید، مجموع هر سفارش به ازای هر خط آن سفارش (و هر محصول) یک‌بار اضافه می‌شد و عددهایی بسیار بالاتر از درآمد واقعی می‌دادید؛ همان دام تکثیر سطر (fan-out) در بخش 2.6. درآمد به تفکیک محصول `qty * price` را از خط‌ها می‌خواهد، نه مجموع سفارش را.

**5. پیوند منفی.** داده‌های seed: هر محصول دست‌کم در یک خط آمده است، پس هر سه شکل **هیچ سطری** برنمی‌گردانند.

</div>

```sql
SELECT p.name FROM products p LEFT JOIN order_lines l ON l.product_id = p.id WHERE l.order_id IS NULL;
SELECT p.name FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.product_id = p.id);
SELECT p.name FROM products p WHERE p.id NOT IN (SELECT product_id FROM order_lines);
```

<div dir="rtl">

پس از `INSERT INTO products VALUES (5, 'Webcam', 59.00)` هر سه، Webcam را برمی‌گردانند. `NOT IN` اینجا فقط به این دلیل کار می‌کند که `order_lines.product_id` از نوع `NOT NULL` است؛ اگر ستون تهی‌پذیر بود و یک NULL داشت، شکل سوم دوباره هیچ‌چیز برنمی‌گرداند.

**6. جای شرط در پیوند خارجی.**

</div>

```sql
-- condition in ON
SELECT c.name, count(o.id) AS big_orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.total > 100 GROUP BY c.id, c.name ORDER BY c.id;
-- condition in WHERE
SELECT c.name, count(o.id) AS big_orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.total > 100 GROUP BY c.id, c.name ORDER BY c.id;
```

<div dir="rtl">

| name | big_orders (ON) |
|---|---|
| Alice | 1 |
| Bob | 1 |
| Chie | 0 |
| Dora | 1 |
| Emil | 0 |

نسخهٔ `WHERE` فقط Alice، Bob و Dora را برمی‌گرداند (هر کدام 1): Chie و Emil سفارشی بالای 100 ندارند، سطر پیوندشده‌شان با NULL پر می‌شود، `NULL > 100` نامعلوم است و سطر حذف می‌شود؛ یعنی پیوند خارجی مثل پیوند داخلی رفتار کرده و شمارش‌های صفر ناپدید شده‌اند.

<a id="i-04"></a>
<a id="chapter-4"></a>
### I-04: SQL II، پرس‌وجوهای پیشرفته

**1. زیرپرس‌وجوها.**

</div>

```sql
SELECT name, price FROM products WHERE price > (SELECT avg(price) FROM products);      -- Monitor 199.00 (average 68.41)

SELECT c.name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.total > 100); -- Chie, Emil

SELECT c.name FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.total > 100
WHERE o.id IS NULL;                                                                     -- Chie, Emil
```

<div dir="rtl">

Emil در هر دو آمده است چون اصلاً سفارشی ندارد، پس سفارشی بالای 100 هم ندارد. اگر پرسش «مشتری‌هایی که سفارش دارند اما هیچ‌کدام بالای 100 نیست» بود، پاسخ فقط Chie می‌شد.

**2. جدول مشتق‌شده / CTE.**

</div>

```sql
WITH per_customer AS (
  SELECT c.id, c.name, count(*) AS orders, sum(o.total) AS revenue
  FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name)
SELECT name, orders, revenue, round(100.0 * revenue / sum(revenue) OVER (), 1) AS pct
FROM per_customer ORDER BY id;
```

<div dir="rtl">

| name | orders | revenue | pct |
|---|---|---|---|
| Alice | 2 | 140.00 | 21.6 |
| Bob | 1 | 199.00 | 30.7 |
| Chie | 1 | 54.15 | 8.4 |
| Dora | 2 | 254.25 | 39.3 |

بدون CTE: `SELECT c.name, count(*), sum(o.total), round(100.0 * sum(o.total) / sum(sum(o.total)) OVER (), 1) FROM customers c JOIN orders o … GROUP BY c.id, c.name`. تابع پنجره‌ای پس از گروه‌بندی اجرا می‌شود، پس می‌تواند جمع‌های گروه‌ها را جمع بزند. Emil سفارشی ندارد و به‌خاطر پیوند داخلی در نتیجه نیست؛ برای آوردنش با مقدار 0 از `LEFT JOIN` و `coalesce` استفاده کنید.

**3. N برتر.**

</div>

```sql
SELECT order_id, product_id, line_value
FROM (SELECT l.order_id, l.product_id, l.qty * p.price AS line_value,
             row_number() OVER (PARTITION BY l.order_id ORDER BY l.qty * p.price DESC) AS rn
      FROM order_lines l JOIN products p ON p.id = l.product_id) t
WHERE rn <= 2 ORDER BY order_id, line_value DESC;
```

<div dir="rtl">

| order_id | product_id | line_value |
|---|---|---|
| 1 | 1 | 99.80 |
| 1 | 2 | 19.50 |
| 2 | 2 | 19.50 |
| 3 | 3 | 199.00 |
| 4 | 1 | 49.90 |
| 4 | 4 | 5.25 |
| 6 | 3 | 199.00 |

سفارش‌های 2، 3 و 6 فقط یک خط دارند. سفارش 5 هیچ خطی ندارد و اصلاً ظاهر نمی‌شود، چون پرس‌وجو از خط‌ها شروع می‌کند. برای نشان‌دادنش با NULL، از `orders` شروع کنید و `LEFT JOIN` بزنید.

**4. تعداد روز از سفارش قبلی** (PostgreSQL؛ نتیجهٔ SQLite همین است).

</div>

```sql
SELECT id, order_date::date AS d,
       coalesce(order_date::date - lag(order_date::date) OVER (ORDER BY order_date, id), 0) AS days_since
FROM orders ORDER BY order_date, id;
```

<div dir="rtl">

| id | d | days_since |
|---|---|---|
| 1 | 2026-01-05 | 0 |
| 2 | 2026-02-11 | 37 |
| 3 | 2026-02-12 | 1 |
| 4 | 2026-03-01 | 17 |
| 5 | 2026-03-02 | 1 |
| 6 | 2026-03-03 | 1 |

برای نخستین سفارش `lag` سطر قبلی ندارد و NULL برمی‌گرداند، پس تفریق NULL می‌شود؛ `coalesce(…, 0)` آن را جایگزین می‌کند. در SQL Server از `DATEDIFF(day, lag(CAST(OrderDate AS date)) OVER (ORDER BY OrderDate, Id), CAST(OrderDate AS date))` استفاده کنید؛ در Oracle دو مقدار `DATE` را از هم کم کنید.

**5. بازگشت.**

</div>

```sql
WITH RECURSIVE sub(id, name, depth) AS (
  SELECT id, name, 0 FROM employees WHERE id = 2
  UNION ALL
  SELECT e.id, e.name, s.depth + 1 FROM employees e JOIN sub s ON e.manager_id = s.id)
SELECT * FROM sub WHERE depth > 0 ORDER BY depth, id;
```

<div dir="rtl">

| id | name | depth |
|---|---|---|
| 4 | Dmitri | 1 |
| 5 | Eli | 1 |
| 6 | Fay | 2 |

پس از `UPDATE employees SET manager_id = 6 WHERE id = 1`، Ada به Fay گزارش می‌دهد که زیر Ben است و Ben زیر Ada: Ben، Dmitri، Fay، Ada، Ben، Dmitri، ... هر گام سطرهای تازه‌ای پیدا می‌کند (همان‌های قبلی دوباره)، پس بازگشت هرگز به گام خالی نمی‌رسد. با محافظ عمق (`WHERE s.depth < 20`)، با نگه‌داشتن مسیر دیده‌شده و خودداری از بازدید دوباره (`WHERE s.path NOT LIKE '%' || e.name || '%'`)، یا با بند `CYCLE` در PostgreSQL 14+ (`CYCLE id SET is_cycle USING path`) جلویش را بگیرید. SQL Server خودش در 100 سطح با خطا متوقف می‌شود.

**6. Upsert.** پس از اجرای اول، `stock` مقدار `(5, 5)` را نگه می‌دارد؛ پس از اجرای دوم `(5, 10)`، چون سطر متعارض به `qty = stock.qty + excluded.qty` به‌روز می‌شود. در MySQL همین نتیجه با `ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)` به دست می‌آید؛ در SQL Server، Oracle، Snowflake و PostgreSQL 15+ از شکل `MERGE` در بخش 2.7 استفاده کنید.

<a id="i-05"></a>
<a id="chapter-5"></a>
### I-05: مدل‌سازی داده و نرمال‌سازی

**1. ناهنجاری‌ها.** *به‌روزرسانی:* ایمیل Alice را در یکی از سه سطرش عوض کنید؛ حالا جدول دو ایمیل برای او دارد. وابستگی مسئول `customer → customer_email` است (و همچنین `order_id → customer_email`). *درج:* تا وقتی کسی محصولی را سفارش نداده، نمی‌توانید محصول تازه‌ای (مثلاً Webcam با قیمت 59.00) ثبت کنید، چون کلید `(order_id, product)` است؛ در وابستگی `product → product_price`، تعیین‌کننده فقط بخشی از کلید است. *حذف:* با حذف سفارش 3 تنها سطری که می‌گوید Bob وجود دارد و در فرانسه زندگی می‌کند از بین می‌رود؛ `order_id → customer, customer_email, customer_country`.

**2. شکل‌های نرمال.** وابستگی‌ها: `student → student_city`، `course → course_room`، `(student, course) → grade`. نخستین نقض **شکل نرمال دوم** است (`student_city` فقط به بخشی از کلید وابسته است، `course_room` هم همین‌طور). تجزیه: `students(student PK, student_city)`، `courses(course PK, course_room)`، `enrolments(student FK, course FK, grade, PK (student, course))`. هر سه در شکل نرمال سوم (و BCNF) هستند.

**3. BCNF.**

</div>

```text
teaches(instructor PK, course)
enrolments(student, instructor, PK (student, instructor), FK instructor -> teaches)
```

<div dir="rtl">

قاعدهٔ «یک دانشجو برای یک درس فقط یک استاد دارد» دیگر با کلید قابل اعمال نیست: چیزی جلوی دانشجو را نمی‌گیرد که نزد دو استاد ثبت‌نام کند که هر دو Databases درس می‌دهند. آن را با تریگر، با قیدی میان جدول‌ها در موتوری که پشتیبانی می‌کند (assertion را موتورهای این کتاب پیاده نکرده‌اند)، با یک نمایهٔ یکتا روی یک پیوند مادی‌شده، یا در برنامه اعمال می‌کنید؛ یا ستون یکتای `(student, course)` غیرنرمال را در کنارش نگه می‌دارید.

**4. افزونگی.**

</div>

```sql
SELECT o.id, o.total, coalesce(sum(l.qty * p.price), 0) AS lines_sum
FROM orders o
LEFT JOIN order_lines l ON l.order_id = o.id
LEFT JOIN products p ON p.id = l.product_id
GROUP BY o.id, o.total
HAVING o.total <> coalesce(sum(l.qty * p.price), 0)
ORDER BY o.id;
```

<div dir="rtl">

| id | total | lines_sum |
|---|---|---|
| 1 | 120.50 | 119.30 |
| 4 | 54.15 | 55.15 |
| 5 | 5.25 | 0.00 |
| 6 | 249.00 | 199.00 |

راه‌های سازگار نگه‌داشتن مجموع: (1) آن را ذخیره نکنید؛ در یک نما (به سبک `customer_orders`) یا پرس‌وجوی تولیدی حسابش کنید: همیشه درست است، و در هر خواندن هزینهٔ یک پیوند و تجمیع دارد. (2) ذخیره‌اش کنید و هر بار که خط‌ها عوض می‌شوند با تریگر یا در برنامه به‌روزش کنید: خواندن ارزان است، نوشتن کندتر و هر مسیر کدی که خط‌ها را تغییر می‌دهد باید به یاد داشته باشد. پایگاه داده نمونهٔ داخلی Rowlit از تریگر استفاده می‌کند (`TR_OrderLines_Insert`، `TR_OrderLines_Delete`). یک فروشگاه واقعی به `order_lines.unit_price` هم نیاز دارد، چون `products.price` با گذر زمان عوض می‌شود و سفارش قدیمی باید قیمتی را نگه دارد که با آن فروخته شده؛ آن واقعیتی دیگر است، نه کپی.

**5. قیدها.**

</div>

```sql
CREATE TABLE reviews (
  customer_id integer NOT NULL,
  product_id  integer NOT NULL,
  rating      integer NOT NULL,
  review_text text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_reviews PRIMARY KEY (customer_id, product_id),
  CONSTRAINT fk_reviews_customers FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_products  FOREIGN KEY (product_id)  REFERENCES products (id)  ON DELETE RESTRICT,
  CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5));
```

<div dir="rtl">

حذف مشتری: `CASCADE`، چون نقدی که نویسنده‌اش را از دست داده صاحبی ندارد (سیاست نگه‌داشتن نقدهای ناشناس `customer_id` تهی‌پذیر و `SET NULL` می‌خواست، که با بخشی از کلید اصلی‌بودنش در تضاد است). حذف محصول: `RESTRICT`، چون نقدها تاریخچه‌اند؛ به‌جای حذف، محصول را «توقف‌شده» علامت بزنید. هر دو انتخاب تصمیم‌های کسب‌وکاری‌اند، نه فنی.

**6. نوع‌ها.**

| ستون | PostgreSQL | SQL Server | چرا |
|---|---|---|---|
| قیمت محصول | `numeric(10,2)` | `decimal(10,2)` | اعشاری دقیق، هرگز float |
| زمان ثبت سفارش | `timestamptz` | `datetimeoffset` (یا `datetime2` با ذخیرهٔ UTC) | یک لحظه است و میان منطقه‌های زمانی قابل مقایسه |
| بارکد (13 رقم، با صفرهای ابتدایی) | `char(13)` یا `varchar(13)` با `CHECK` روی ارقام | `char(13)` | شناسه است، نه عدد: حساب‌وکتابی در کار نیست و صفرهای ابتدایی اهمیت دارند |
| زبان مورد علاقه | کد `varchar(10)` مثل `fa`، یا کلید خارجی به جدول `languages` | `varchar(10)` | کدی از فهرستی بسته؛ جدول مرجع اعتبارسنجی اضافه می‌کند |
| متوقف‌شده | `boolean NOT NULL DEFAULT false` | `bit NOT NULL DEFAULT 0` | دو حالت؛ `NOT NULL` از حالت سوم جلوگیری می‌کند |

<a id="i-06"></a>
<a id="chapter-6"></a>
### I-06: درونیات ذخیره‌سازی

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-06 است.

<a id="i-07"></a>
<a id="chapter-7"></a>
### I-07: نمایه‌ها در عمق

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-07 است.

<a id="i-08"></a>
<a id="chapter-8"></a>
### I-08: خط لولهٔ پرس‌وجو و بهینه‌ساز

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-08 است.

<a id="i-09"></a>
<a id="chapter-9"></a>
### I-09: تراکنش‌ها، ACID و سطح‌های انزوا

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-09 است.

<a id="i-10"></a>
<a id="chapter-10"></a>
### I-10: همروندی: قفل‌ها، latchها، MVCC

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-10 است.

<a id="i-11"></a>
<a id="chapter-11"></a>
### I-11: WAL، redo/undo، checkpointها، بازیابی

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-11 است.

<a id="i-12"></a>
<a id="chapter-12"></a>
### I-12: پشتیبان‌گیری، همانندسازی، دسترس‌پذیری بالا، پارتیشن‌بندی

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-12 است.

<a id="i-13"></a>
<a id="chapter-13"></a>
### I-13: روش‌شناسی تنظیم کارایی

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-13 است.

<a id="i-14"></a>
<a id="chapter-14"></a>
### I-14: امنیت پایگاه داده

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-14 است.

<a id="i-15"></a>
<a id="chapter-15"></a>
### I-15: OLTP در برابر OLAP و موتورهای ستونی

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-15 است.

<a id="i-16"></a>
<a id="chapter-16"></a>
### I-16: خانواده‌های NoSQL و درونیاتشان

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-16 است.

<a id="i-17"></a>
<a id="chapter-17"></a>
### I-17: مقایسهٔ هشت گویش رابطه‌ای

پاسخ‌ها را بسته‌ای اضافه می‌کند که صاحب فصل I-17 است.

## فصل‌های مرتبط

- [چگونه این کتاب را بخوانیم](../00-how-to-read.md)، بخش 6: سه روش اجرای مثال‌ها.
- فصل‌هایی که تمرین‌هایشان در بالا پاسخ داده شد: [I-01](01-what-is-a-database.md)، [I-02](02-relational-model.md)، [I-03](03-sql-basics.md)،
  [I-04](04-sql-advanced.md)، [I-05](05-modelling-and-normalisation.md).
- بخش دوم: [II-04 اجرای Rowlit از سورس](../part2/04-development-setup.md) از همین سرورهای Docker استفاده می‌کند، و
  [II-23 آزمون و کنترل کیفیت](../part2/23-testing-and-qa.md) توضیح می‌دهد آزمون‌های یکپارچگی پروژه چگونه از آن‌ها بهره می‌برند.

## اصطلاحات جدید این فصل

[Docker Compose](../glossary.md#docker-compose)، [seed](../glossary.md#seed)، [fixture](../glossary.md#fixture).

</div>
