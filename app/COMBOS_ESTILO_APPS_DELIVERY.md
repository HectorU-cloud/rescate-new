# Combos al estilo de las apps de delivery

Cambios solo de interfaz y de cálculo en el navegador: **no hay cambios de base de datos** y el servidor sigue validando opciones y precio como antes.

## Hoja del combo (`ProductOptionsDialog`)
- En el celular sube desde abajo como hoja; en pantallas grandes sigue siendo una ventana centrada.
- Foto del producto arriba, nombre, precio base y descripción.
- Cada grupo muestra «Obligatorio»/«Opcional», cuántas opciones se pueden elegir («Elige 1», «Elige hasta 3», «Elige entre 1 y 2»), el contador (1/3) y «Listo» cuando ya está completo.
- Filas completas para tocar, con círculo (una opción) o casilla (varias) a la derecha y el adicional con su precio («+$0.50»).
- Al elegir una opción única obligatoria, la hoja baja sola al siguiente grupo que falta.
- Si falta algo obligatorio, el botón no queda muerto: al tocarlo marca en rojo los grupos pendientes y lleva al primero.
- Selector de cantidad junto al botón, y el botón muestra el total («Agregar · $12.40»).

## Menú
- Las tarjetas de combos dicen «🧩 Personalizable» y muestran «Desde $X» cuando los grupos obligatorios tienen costo (`fromPrice`).
- Un globo con la cantidad que ya hay en el carrito de cada producto.

## Carrito
- Lo elegido se muestra una línea por grupo (Cola: Fanta · Extras: Chorizo (+$0.50)).
- «Editar» abre la misma hoja con lo elegido y la cantidad; al guardar reemplaza la línea (si coincide con otra línea igual, se juntan). Si el producto ya no está disponible, no aparece «Editar».

## Pruebas
Casos nuevos en `server/lib/options.test.ts` (`selectionHint`, `firstUnmetGroupId`, `fromPrice`, `groupOptions`).
