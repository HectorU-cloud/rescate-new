-- Foto o logo del local (opcional). El emoji sigue siendo el respaldo cuando no hay foto.
-- Ejecutar UNA sola vez en la base de producción (MySQL no admite ADD COLUMN IF NOT EXISTS).
ALTER TABLE `businesses`
  ADD COLUMN `imageUrl` mediumtext NULL;
