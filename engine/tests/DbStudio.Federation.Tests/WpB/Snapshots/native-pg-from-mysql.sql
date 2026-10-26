-- kind: fdw
-- placeholders: <password>
-- note: mysql_fdw is not part of PostgreSQL: install it on the PostgreSQL server (e.g. the postgresql-NN-mysql-fdw package) together with the MySQL client library.
-- note: The member's host is 'localhost' as Rowlit reaches it; from the target server (another machine, a container) it is probably a different address.
-- Foreign server crm → mysql member 'crm' (mysql sample)
-- Replace the placeholders before running.
CREATE EXTENSION IF NOT EXISTS mysql_fdw;
CREATE SERVER crm FOREIGN DATA WRAPPER mysql_fdw OPTIONS (host 'localhost', port '13306');
CREATE USER MAPPING FOR CURRENT_USER SERVER crm OPTIONS (username 'shop', password '<password>');
CREATE SCHEMA IF NOT EXISTS crm;
IMPORT FOREIGN SCHEMA "shop" LIMIT TO (customers, orders) FROM SERVER crm INTO crm;

-- Examples
SELECT * FROM crm.customers LIMIT 100;
SELECT * FROM crm.orders LIMIT 100;
-- Remove: DROP SCHEMA crm CASCADE; DROP SERVER crm CASCADE;
