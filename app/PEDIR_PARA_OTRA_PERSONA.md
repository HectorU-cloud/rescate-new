# Pedir para otra persona

En el carrito, con «A domicilio», el cliente elige **🙋 Para mí** o **🎁 Para otra persona**.

Para otra persona:

- Pide el nombre y el celular de quien recibe. El nombre viaja en la nota del pedido («Entregar a: María · …»), que ven el local y el repartidor; el celular es el de contacto del pedido. No se cambia la base de datos.
- Aparece un mapa con un pin 🏠. El cliente escribe la dirección y, ~1 s después de dejar de escribir, el mapa se actualiza solo (también hay un botón «Buscar esta dirección en el mapa»). Si hay varias coincidencias, se muestran para elegir.
- Puede tocar el mapa o arrastrar el pin: desde ese momento escribir ya no lo mueve de vuelta (hasta que pulse el botón de buscar).
- Cambiar entre «Para mí» y «Para otra persona» borra el punto y la dirección para no entregar en un sitio equivocado.

## Cómo se busca la dirección (servidor: `orders.searchAddress`)

- El texto se envía **tal cual** lo escribió el cliente. Nunca se le agrega una ciudad.
- La ciudad elegida en la app solo da un **sesgo suave** (`viewbox` en Nominatim, `bounds` en Google), y únicamente si el texto no nombra ya una de nuestras ciudades (`mentionsKnownCity`). Así «Av. Quito y Calle 5, Guayaquil» se busca en Guayaquil aunque la ciudad elegida sea Milagro.
- Solo se devuelven puntos dentro de la zona de servicio. Usa los mismos proveedores y variables que la dirección sugerida por GPS (`GOOGLE_GEOCODING_API_KEY`, `NOMINATIM_CONTACT`, `REVERSE_GEOCODING_ENABLED=false` lo apaga) y comparte el límite de 1 consulta por segundo de Nominatim. Límite por usuario: 80 búsquedas por hora.
- Si el servicio no está disponible, el cliente marca el punto tocando el mapa; nunca bloquea el pedido.
