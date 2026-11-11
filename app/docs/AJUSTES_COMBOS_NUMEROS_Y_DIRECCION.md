# Combos en productos existentes, campos numéricos y dirección automática

## 1. Combos: marcar las opciones en un producto que ya existe
**Qué pasaba:** la casilla de «Opciones del producto (combo)» del formulario de arriba solo forma parte del producto que se está
escribiendo; no se guarda hasta pulsar «Agregar al menú» (que exige nombre y precio) y se pierde al salir. Para un producto que ya estaba
en el menú había que pulsar «Editar», marcar y «Guardar cambios», algo poco evidente.

**Ahora:** cada producto del menú tiene su propio desplegable **«🧩 Opciones de combo»** con los grupos del local. Al marcar o desmarcar,
**se guarda al instante** (aviso «Combo actualizado») y el estado queda visible al volver. Los clientes lo ven al abrir el local.
El formulario de arriba sigue igual, pero ahora explica cuándo se guarda lo marcado y, si el botón está desactivado, qué falta (nombre y/o precio).

Nota: los grupos se crean primero en «Opciones de combos». Un producto solo aparece como combo en el local cuando tiene al menos un grupo marcado.

## 2. Campos numéricos que no se podían borrar
Al registrar el local, y en «Horario y reglas de entrega» del panel, el número se convertía a 0 al borrar el campo y quedaba pegado.
Ahora los campos se editan como texto, se pueden vaciar y se validan al guardar (rango y «Escribe un valor» si quedó vacío). Acepta coma o punto decimal.

## 3. Dirección automática al usar «Usar mi ubicación»
Al tocar el botón, además de guardar la ubicación se **sugiere la dirección escrita** (calle, número, barrio y ciudad) en el campo de dirección.
- Solo rellena si el campo está vacío o si ya contenía una sugerencia anterior: **nunca pisa lo que el cliente escribió.**
- Avisa que es una sugerencia y pide corregirla y agregar una referencia. Si no se pudo obtener, el cliente escribe su dirección como siempre.
- Solo funciona dentro de la zona de servicio, requiere sesión iniciada y está limitada a 40 consultas por hora por usuario; los resultados se guardan en memoria 24 h.

### Proveedor (configuración en el backend)
| Variable | Efecto |
|---|---|
| *(ninguna)* | Usa **OpenStreetMap Nominatim**: gratis, sin clave. Su política pide poco volumen y como máximo 1 consulta por segundo (el código lo respeta) y que te identifiques. |
| `NOMINATIM_CONTACT` | Correo o sitio que se añade al User-Agent, como pide la política de OSM. **Ponlo.** |
| `GOOGLE_GEOCODING_API_KEY` | Usa **Google Geocoding API** (más precisa, de pago por consulta). Activa esa API en Google Cloud y restringe la clave a ella. |
| `REVERSE_GEOCODING_ENABLED=false` | Apaga la función. |

Para mucho volumen, usa Google o un Nominatim propio: el servicio público de OSM no es para uso intensivo. La precisión de OSM en direcciones de Milagro
puede ser baja (a veces solo calle o barrio, sin número): por eso es una sugerencia.

**Privacidad:** se envían las coordenadas al proveedor solo para esa consulta. La política de privacidad ya lo menciona (por defecto, OpenStreetMap);
si cambias a Google, ajusta ese texto.

## Pruebas
`server/lib/number-input.test.ts`, `server/lib/reverse-geocode.test.ts` y un caso nuevo en `server/pricing.integration.test.ts` (combos; requiere `TEST_DATABASE_URL`).
