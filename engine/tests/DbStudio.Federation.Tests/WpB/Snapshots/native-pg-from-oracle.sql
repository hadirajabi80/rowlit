-- kind: fdw
-- placeholders: <password>
-- note: oracle_fdw must be installed on the PostgreSQL server with the Oracle Instant Client; Oracle schema names are upper case.
-- Foreign server crm → oracle member 'crm' (oracle sample)
-- Replace the placeholders before running.
CREATE EXTENSION IF NOT EXISTS oracle_fdw;
CREATE SERVER crm FOREIGN DATA WRAPPER oracle_fdw OPTIONS (dbserver '//ora.example.com:15211/FREEPDB1');
CREATE USER MAPPING FOR CURRENT_USER SERVER crm OPTIONS (user 'shop', password '<password>');
CREATE SCHEMA IF NOT EXISTS crm;
IMPORT FOREIGN SCHEMA "SHOP" LIMIT TO (customers, orders) FROM SERVER crm INTO crm;

-- Examples
SELECT * FROM crm.customers LIMIT 100;
SELECT * FROM crm.orders LIMIT 100;
-- Remove: DROP SCHEMA crm CASCADE; DROP SERVER crm CASCADE;
