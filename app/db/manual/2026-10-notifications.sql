-- Centro de notificaciones (tabla `notifications`).
-- Seguro de ejecutar más de una vez. Úsalo en la base de producción creada con `db:push` antes de
-- regenerar la línea base de migraciones (ver docs/NOTIFICACIONES_CENTRO.md).
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` serial AUTO_INCREMENT NOT NULL,
  `userId` bigint unsigned NOT NULL,
  `orderId` bigint unsigned NULL,
  `title` varchar(120) NOT NULL,
  `body` varchar(300) NOT NULL,
  `url` varchar(200) NULL,
  `tag` varchar(80) NULL,
  `readAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `notifications_id` PRIMARY KEY (`id`),
  KEY `notif_user_idx` (`userId`, `createdAt`),
  CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `notifications_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE SET NULL
);
