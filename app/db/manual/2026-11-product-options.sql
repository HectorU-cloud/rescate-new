-- Opciones de producto (combos configurables: sabor de la cola, tamaño de papas, extras con precio).
-- Ejecutar UNA sola vez en la base de producción (en local basta `npm run db:push`).
-- Solo crea tablas nuevas: no toca productos ni pedidos existentes.

CREATE TABLE `option_groups` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `businessId` bigint unsigned NOT NULL,
  `name` varchar(100) NOT NULL,
  `minSelect` int NOT NULL DEFAULT 0,
  `maxSelect` int NOT NULL DEFAULT 1,
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `optgrp_biz_idx` (`businessId`),
  CONSTRAINT `option_groups_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE cascade ON UPDATE no action
);

CREATE TABLE `option_choices` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `groupId` bigint unsigned NOT NULL,
  `name` varchar(100) NOT NULL,
  `priceDelta` double NOT NULL DEFAULT 0,
  `isAvailable` boolean NOT NULL DEFAULT true,
  `sortOrder` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `optchoice_group_idx` (`groupId`),
  CONSTRAINT `option_choices_groupId_option_groups_id_fk` FOREIGN KEY (`groupId`) REFERENCES `option_groups`(`id`) ON DELETE cascade ON UPDATE no action
);

CREATE TABLE `product_option_groups` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `productId` bigint unsigned NOT NULL,
  `groupId` bigint unsigned NOT NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prodoptgrp_unique` (`productId`, `groupId`),
  KEY `prodoptgrp_group_idx` (`groupId`),
  CONSTRAINT `product_option_groups_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action,
  CONSTRAINT `product_option_groups_groupId_option_groups_id_fk` FOREIGN KEY (`groupId`) REFERENCES `option_groups`(`id`) ON DELETE cascade ON UPDATE no action
);

CREATE TABLE `order_item_options` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `orderItemId` bigint unsigned NOT NULL,
  `groupName` varchar(100) NOT NULL,
  `choiceName` varchar(100) NOT NULL,
  `priceDelta` double NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `itemopt_item_idx` (`orderItemId`),
  CONSTRAINT `order_item_options_orderItemId_order_items_id_fk` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE cascade ON UPDATE no action
);
