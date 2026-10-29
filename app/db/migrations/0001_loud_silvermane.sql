CREATE TABLE `finance_settings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`serviceFee` double NOT NULL DEFAULT 0.45,
	`courierDebtLimit` double NOT NULL DEFAULT 5,
	`businessDebtLimit` double NOT NULL DEFAULT 15,
	`deliveryBaseFee` double NOT NULL DEFAULT 0.8,
	`deliveryPerKm` double NOT NULL DEFAULT 0.3,
	`deliveryPerMinute` double NOT NULL DEFAULT 0.04,
	`dynamicPricingEnabled` boolean NOT NULL DEFAULT false,
	`updatedBy` bigint unsigned,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `finance_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wallet_entries` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`walletType` enum('courier','business') NOT NULL,
	`walletId` bigint unsigned NOT NULL,
	`entryType` enum('charge','payment','adjustment') NOT NULL,
	`amount` double NOT NULL,
	`status` enum('pending','confirmed','rejected') NOT NULL DEFAULT 'confirmed',
	`orderId` bigint unsigned,
	`description` varchar(300) NOT NULL,
	`paymentReference` varchar(120),
	`proofUrl` text,
	`reviewedBy` bigint unsigned,
	`reviewedAt` timestamp,
	`createdBy` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wallet_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `finance_settings` ADD CONSTRAINT `finance_settings_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_entries` ADD CONSTRAINT `wallet_entries_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_entries` ADD CONSTRAINT `wallet_entries_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallet_entries` ADD CONSTRAINT `wallet_entries_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `wallet_entry_wallet_idx` ON `wallet_entries` (`walletType`,`walletId`);--> statement-breakpoint
CREATE INDEX `wallet_entry_status_idx` ON `wallet_entries` (`status`);--> statement-breakpoint
CREATE INDEX `wallet_entry_order_idx` ON `wallet_entries` (`orderId`);