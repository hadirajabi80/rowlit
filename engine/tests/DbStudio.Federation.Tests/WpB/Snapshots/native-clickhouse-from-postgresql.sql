-- kind: clickhouseEngine
-- placeholders: <password>
-- note: The database engine maps every table of the remote database/schema; ClickHouse reads them on each query (no copy).
-- Database crm → postgresql member 'crm' (postgresql sample), read live through the PostgreSQL database engine
-- Replace the placeholders before running.
CREATE DATABASE IF NOT EXISTS `crm` ENGINE = PostgreSQL('pg.example.com:15432', 'shop', 'shop', '<password>', 'public');

-- Examples
SELECT * FROM `crm`.`customers` LIMIT 100;
SELECT * FROM `crm`.`orders` LIMIT 100;
-- Remove: DROP DATABASE `crm`;
