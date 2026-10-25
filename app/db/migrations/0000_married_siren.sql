CREATE TABLE `auth_tokens` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`purpose` enum('verify_email','reset_password') NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`ownerId` bigint unsigned NOT NULL,
	`name` varchar(150) NOT NULL,
	`description` text,
	`category` varchar(60) NOT NULL,
	`address` varchar(255) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`phone` varchar(30),
	`emoji` varchar(8) NOT NULL DEFAULT '🍽️',
	`isOpen` boolean NOT NULL DEFAULT true,
	`deliveryFee` double NOT NULL DEFAULT 1,
	`feePerKm` double NOT NULL DEFAULT 0.25,
	`deliveryRadiusKm` double NOT NULL DEFAULT 5,
	`minOrder` double NOT NULL DEFAULT 0,
	`opensAt` varchar(5) NOT NULL DEFAULT '08:00',
	`closesAt` varchar(5) NOT NULL DEFAULT '22:00',
	`approvalStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'approved',
	`approvalNote` varchar(300),
	`pendingName` varchar(150),
	`pendingAddress` varchar(255),
	`locationConfirmed` boolean NOT NULL DEFAULT false,
	`approvedLat` double,
	`approvedLng` double,
	`deliveryMinutes` int NOT NULL DEFAULT 30,
	`rating` double NOT NULL DEFAULT 4.5,
	`ratingCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `businesses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`orderId` bigint unsigned NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`reporterRole` enum('customer','business','courier') NOT NULL,
	`reason` varchar(500) NOT NULL,
	`status` enum('open','resolved','rejected') NOT NULL DEFAULT 'open',
	`resolution` varchar(500),
	`resolvedBy` bigint unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `courier_locations` (
	`orderId` bigint unsigned NOT NULL,
	`courierId` bigint unsigned NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`accuracy` double,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `courier_locations_orderId` PRIMARY KEY(`orderId`)
);
--> statement-breakpoint
CREATE TABLE `customer_addresses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`label` varchar(60) NOT NULL DEFAULT 'Casa',
	`address` varchar(300) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`isDefault` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_addresses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`orderId` bigint unsigned NOT NULL,
	`actorId` bigint unsigned,
	`actorRole` varchar(20) NOT NULL,
	`type` varchar(40) NOT NULL,
	`detail` varchar(300),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`orderId` bigint unsigned NOT NULL,
	`productId` bigint unsigned,
	`rescuePackId` bigint unsigned,
	`name` varchar(150) NOT NULL,
	`unitPrice` double NOT NULL,
	`quantity` int NOT NULL,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_messages` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`orderId` bigint unsigned NOT NULL,
	`courierId` bigint unsigned NOT NULL,
	`senderId` bigint unsigned NOT NULL,
	`senderRole` enum('customer','courier') NOT NULL,
	`body` varchar(500) NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`code` varchar(20) NOT NULL,
	`type` enum('delivery','rescue') NOT NULL,
	`status` enum('pending','accepted','preparing','ready','picked_up','delivered','cancelled') NOT NULL DEFAULT 'pending',
	`customerId` bigint unsigned NOT NULL,
	`businessId` bigint unsigned NOT NULL,
	`courierId` bigint unsigned,
	`subtotal` double NOT NULL,
	`deliveryFee` double NOT NULL DEFAULT 0,
	`total` double NOT NULL,
	`paymentMethod` enum('cash') NOT NULL DEFAULT 'cash',
	`deliveryAddress` varchar(300),
	`deliveryLat` double,
	`deliveryLng` double,
	`notes` varchar(300),
	`pickupCode` varchar(6),
	`courierPickupCode` varchar(6),
	`deliveryConfirmationCode` varchar(6),
	`customerName` varchar(150),
	`customerPhone` varchar(30),
	`deliveryDistanceKm` double,
	`readyAt` timestamp,
	`courierReminderSentAt` timestamp,
	`codeAttempts` int NOT NULL DEFAULT 0,
	`businessReminderSentAt` timestamp,
	`courierAcceptedAt` timestamp,
	`deliveredAt` timestamp,
	`cancelledBy` enum('customer','business','admin','system'),
	`cancelReason` varchar(300),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`businessId` bigint unsigned NOT NULL,
	`name` varchar(150) NOT NULL,
	`description` varchar(300),
	`imageUrl` mediumtext,
	`price` double NOT NULL,
	`emoji` varchar(8) NOT NULL DEFAULT '🍽️',
	`isAvailable` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`token` varchar(700) NOT NULL,
	`platform` enum('web','android','ios') NOT NULL DEFAULT 'web',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `push_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`orderId` bigint unsigned NOT NULL,
	`customerId` bigint unsigned NOT NULL,
	`businessId` bigint unsigned NOT NULL,
	`courierId` bigint unsigned,
	`businessStars` int NOT NULL,
	`businessComment` varchar(300),
	`courierStars` int,
	`courierComment` varchar(300),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ratings_id` PRIMARY KEY(`id`),
	CONSTRAINT `rating_order_uq` UNIQUE(`orderId`)
);
--> statement-breakpoint
CREATE TABLE `rescue_packs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`businessId` bigint unsigned NOT NULL,
	`title` varchar(150) NOT NULL,
	`description` varchar(300),
	`imageUrl` mediumtext,
	`originalPrice` double NOT NULL,
	`rescuePrice` double NOT NULL,
	`quantityTotal` int NOT NULL,
	`quantityLeft` int NOT NULL,
	`pickupStart` varchar(5) NOT NULL,
	`pickupEnd` varchar(5) NOT NULL,
	`expiresAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rescue_packs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`passwordHash` varchar(255),
	`emailVerifiedAt` timestamp,
	`sessionVersion` int NOT NULL DEFAULT 0,
	`avatar` text,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`appRole` enum('customer','business','courier'),
	`phone` varchar(30),
	`courierPhotoUrl` text,
	`courierVehicle` varchar(80),
	`courierPlate` varchar(20),
	`courierBio` varchar(300),
	`courierApproved` boolean NOT NULL DEFAULT false,
	`courierVerification` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`courierReviewNote` varchar(300),
	`courierAvailable` boolean NOT NULL DEFAULT true,
	`courierRating` double,
	`courierRatingCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	`deletedAt` timestamp,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `businesses` ADD CONSTRAINT `businesses_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `claims` ADD CONSTRAINT `claims_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `claims` ADD CONSTRAINT `claims_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `claims` ADD CONSTRAINT `claims_resolvedBy_users_id_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_locations` ADD CONSTRAINT `courier_locations_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_locations` ADD CONSTRAINT `courier_locations_courierId_users_id_fk` FOREIGN KEY (`courierId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_rescuePackId_rescue_packs_id_fk` FOREIGN KEY (`rescuePackId`) REFERENCES `rescue_packs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_messages` ADD CONSTRAINT `order_messages_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_messages` ADD CONSTRAINT `order_messages_courierId_users_id_fk` FOREIGN KEY (`courierId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_messages` ADD CONSTRAINT `order_messages_senderId_users_id_fk` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customerId_users_id_fk` FOREIGN KEY (`customerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_courierId_users_id_fk` FOREIGN KEY (`courierId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_tokens` ADD CONSTRAINT `push_tokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ratings` ADD CONSTRAINT `ratings_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ratings` ADD CONSTRAINT `ratings_customerId_users_id_fk` FOREIGN KEY (`customerId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ratings` ADD CONSTRAINT `ratings_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ratings` ADD CONSTRAINT `ratings_courierId_users_id_fk` FOREIGN KEY (`courierId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rescue_packs` ADD CONSTRAINT `rescue_packs_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auth_token_user_idx` ON `auth_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `biz_owner_idx` ON `businesses` (`ownerId`);--> statement-breakpoint
CREATE INDEX `biz_category_idx` ON `businesses` (`category`);--> statement-breakpoint
CREATE INDEX `claim_order_idx` ON `claims` (`orderId`);--> statement-breakpoint
CREATE INDEX `claim_status_idx` ON `claims` (`status`);--> statement-breakpoint
CREATE INDEX `customer_address_user_idx` ON `customer_addresses` (`userId`);--> statement-breakpoint
CREATE INDEX `evt_order_idx` ON `order_events` (`orderId`);--> statement-breakpoint
CREATE INDEX `item_order_idx` ON `order_items` (`orderId`);--> statement-breakpoint
CREATE INDEX `msg_order_idx` ON `order_messages` (`orderId`,`id`);--> statement-breakpoint
CREATE INDEX `ord_customer_idx` ON `orders` (`customerId`);--> statement-breakpoint
CREATE INDEX `ord_biz_idx` ON `orders` (`businessId`);--> statement-breakpoint
CREATE INDEX `ord_courier_idx` ON `orders` (`courierId`);--> statement-breakpoint
CREATE INDEX `ord_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `prod_biz_idx` ON `products` (`businessId`);--> statement-breakpoint
CREATE INDEX `push_user_idx` ON `push_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `rating_biz_idx` ON `ratings` (`businessId`);--> statement-breakpoint
CREATE INDEX `rating_courier_idx` ON `ratings` (`courierId`);--> statement-breakpoint
CREATE INDEX `pack_biz_idx` ON `rescue_packs` (`businessId`);