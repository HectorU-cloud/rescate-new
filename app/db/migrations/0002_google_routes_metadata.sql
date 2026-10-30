-- Metadatos de la ruta usados para cotizar y auditar cada entrega.
ALTER TABLE `orders`
  ADD COLUMN `deliveryDurationMinutes` int NULL,
  ADD COLUMN `deliveryRouteProvider` enum('google','fallback') NULL;
