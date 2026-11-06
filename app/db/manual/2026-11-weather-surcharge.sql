-- Recargo por mal clima (configurable en Admin → Finanzas). Ejecutar UNA sola vez en producción.
-- Queda desactivado ('off') hasta que el admin lo active.
ALTER TABLE `finance_settings`
  ADD COLUMN `weatherSurchargeMode` enum('off','heavy','rain') NOT NULL DEFAULT 'off',
  ADD COLUMN `weatherSurcharge` double NOT NULL DEFAULT 0.5;
