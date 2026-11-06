# Opciones de combo (sabor, tamaño y extras con precio)

Permite que un producto sea un **combo configurable**: al tocarlo, el cliente elige (por ejemplo) el sabor de la cola,
si las papas son pequeñas o grandes y si agrega chorizo; el precio se recalcula con el adicional que cobra el local.

## Cómo lo usa el local
1. Menú → **Opciones de combos** → *+ Nuevo grupo*. Ejemplos:
   - «Sabor de la cola»: *debe elegir*, máximo 1 → Coca-Cola, Fanta, Sprite.
   - «Tamaño de papas»: *debe elegir*, máximo 1 → Pequeñas (incluidas), Grandes (+$0.50).
   - «Extras»: opcional, máximo 3 → Chorizo (+$0.50), Queso (+$0.35).
2. Al crear o editar un producto, marca los grupos que le correspondan.
3. Los grupos son del local y se reutilizan en todos sus productos; **cada local pone sus propios precios**.
   Una opción se puede marcar «Agotado» sin borrarla.

## Cómo funciona por dentro
- Tablas nuevas: `option_groups`, `option_choices`, `product_option_groups`, `order_item_options`.
- `catalog.businessDetail` devuelve `optionGroups` en cada producto.
- `orders.createDelivery` recibe `options` (ids de opciones) por ítem. **El servidor valida y recalcula el precio**
  (`contracts/options.ts`): `unitPrice = precio del producto + adicionales`. El cliente no puede fijarlo.
- El pedido guarda una copia del nombre y del precio de cada opción elegida, así que editar o borrar el grupo después
  no cambia pedidos ya hechos. El local ve lo elegido bajo cada ítem de sus pedidos.
- El carrito identifica cada línea por producto + opciones: un combo con Fanta y otro con Coca-Cola son líneas distintas.
- «Repetir pedido» vuelve a buscar las mismas opciones por nombre con los precios de hoy; si alguna ya no existe o está
  agotada, ese ítem se omite.
- Los packs de rescate no usan opciones.

## Base de datos
- Local / base nueva: `npm run db:push`.
- Producción: ejecutar **una sola vez** `db/manual/2026-11-product-options.sql`. Solo crea tablas nuevas.
