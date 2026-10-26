-- kind: fdw
-- placeholders: <password>
-- note: postgres_fdw ships with PostgreSQL (contrib); creating the extension needs superuser or the pg_database_owner role.
-- Foreign server crm → postgresql member 'crm' (postgresql sample)
-- Replace the placeholders before running.
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER crm FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'pg.example.com', port '15432', dbname 'shop');
CREATE USER MAPPING FOR CURRENT_USER SERVER crm OPTIONS (user 'shop', password '<password>');
CREATE SCHEMA IF NOT EXISTS crm;
IMPORT FOREIGN SCHEMA "public" LIMIT TO (customers, orders) FROM SERVER crm INTO crm;

-- Examples
SELECT * FROM crm.customers LIMIT 100;
SELECT * FROM crm.orders LIMIT 100;
-- Remove: DROP SCHEMA crm CASCADE; DROP SERVER crm CASCADE;
