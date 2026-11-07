-- Ciudad de trabajo del repartidor (los repartidores solo ven pedidos de su ciudad). Ejecutar UNA sola vez en producción.
-- Queda en NULL: cada repartidor elige su ciudad la próxima vez que abra su panel (hasta entonces no ve pedidos).
ALTER TABLE `users`
  ADD COLUMN `courierCityId` varchar(40) NULL;
