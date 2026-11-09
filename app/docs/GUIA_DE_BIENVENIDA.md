# Guía de bienvenida

Una serie corta de tarjetas que explica la app a quien entra por primera vez, con un botón final
(para clientes: **"¡Sí, comencemos esos rescates! 🧡"**, que lleva a Rescates).

## Cuándo aparece
- Se muestra **una sola vez por dispositivo y por rol**, en la pantalla principal de cada rol:
  | Rol | Pantalla |
  | --- | --- |
  | Cliente | Inicio (`/`) y Rescates (`/rescate`) |
  | Local | Panel (`/panel`) |
  | Repartidor | Panel (`/repartidor`) |
- Solo la ve quien tiene ese rol (un dueño de local que pasa por Inicio no ve la guía de clientes). El admin no tiene guía.
- La pregunta de la ciudad **espera** a que termine la guía: nunca se encimen dos ventanas.
  Flujo de un cliente nuevo: elige rol → guía → "comencemos esos rescates" → pregunta de ciudad → lista de rescates.

## Cómo se usa
- **Siguiente / Atrás**, o deslizar el dedo en el celular. **Saltar guía** está siempre a mano.
- Un toque fuera de la tarjeta **no** la cierra (evita cerrarla por accidente); se sale con "Saltar guía" o con Esc.
- Se puede repetir desde **Perfil → Guía de bienvenida → Ver la guía otra vez**.
- Respeta "reducir movimiento" del sistema (sin animaciones).

## Dónde se edita
- **Textos y pasos:** `src/lib/tour-steps.ts` (un bloque por rol). Cada paso: emoji, título, texto y hasta 3 viñetas.
- **Botón final y a dónde lleva:** `TOUR_FINISH` en el mismo archivo.
- Hay pruebas que exigen que la guía sea corta (4 a 7 pasos, textos breves) y que lo que promete coincida con las reglas
  (25 y 60 minutos de un pedido sin avanzar, 15 minutos para recoger, etc.). Si cambias una regla, cambia su paso.

## Cuándo volver a mostrarla a todos
Sube `TOUR_VERSION` en `src/lib/tour-state.ts`. Por ejemplo, tras un cambio grande del producto.

## Qué se guarda
Solo una marca en el `localStorage` del dispositivo (`rescate-tour-v1-<rol>`). No se envía nada al servidor.
Consecuencia: quien entra desde otro celular o navegador la verá otra vez (se puede saltar).
Si el navegador bloquea el almacenamiento, la guía se recuerda mientras dure la sesión.
