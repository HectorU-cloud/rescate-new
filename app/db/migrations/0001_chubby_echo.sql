ALTER TABLE `orders` ADD `fulfillmentMethod` enum('delivery','pickup') DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `serviceFee` double DEFAULT 0 NOT NULL;