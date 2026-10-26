-- kind: federated
-- placeholders: <password>
-- note: MariaDB: FEDERATEDX must be loaded (INSTALL SONAME 'ha_federatedx'); the column list must match the remote table.
-- note: The member's host is 'localhost' as Rowlit reaches it; from the target server (another machine, a container) it is probably a different address.
-- FEDERATED tables over server crm_fed → mysql member 'crm' (mysql sample)
-- Replace the placeholders before running.
CREATE SERVER `crm_fed` FOREIGN DATA WRAPPER mysql OPTIONS (HOST 'localhost', PORT 13306, DATABASE 'shop', USER 'shop', PASSWORD '<password>');

CREATE TABLE `crm_fed_customers` (
    `id` int NOT NULL,
    `name` varchar(100) NOT NULL,
    `email` varchar(200),
    PRIMARY KEY (`id`)
) ENGINE = FEDERATED CONNECTION = 'crm_fed/customers';

CREATE TABLE `crm_fed_orders` (
    `id` int NOT NULL,
    `total` decimal(10,2),
    PRIMARY KEY (`id`)
) ENGINE = FEDERATED CONNECTION = 'crm_fed/orders';

-- Remove: DROP TABLE … ; DROP SERVER `crm_fed`;
