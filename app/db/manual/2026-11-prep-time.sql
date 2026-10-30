-- Tiempo de preparación por pedido (lo indica el comercio al aceptar).
-- Ejecutar UNA sola vez en la base de producción (MySQL no admite ADD COLUMN IF NOT EXISTS).
ALTER TABLE `orders`
  ADD COLUMN `prepMinutes` int NULL,
  ADD COLUMN `estimatedReadyAt` timestamp NULL;
