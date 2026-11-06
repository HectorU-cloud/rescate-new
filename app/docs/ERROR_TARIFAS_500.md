# La tarifa de servicio y el envío aparecen como «—» (error 500 en `orders.fees`)

En el carrito, «Tarifa de servicio» y «Total a pagar» salen como «—» y aparece «No pudimos cargar las tarifas». En la pestaña Network, la llamada `orders.fees` responde **500**.

## Qué significa
`orders.fees` solo lee la configuración de tarifas de la tabla `finance_settings`. Que responda 500 casi siempre indica que **la base de datos de producción no tiene todavía el esquema que usa el código** (la tabla `finance_settings` o alguna de sus columnas, creadas en la fase de Finanzas). No hay nada que «activar» en la app: hay que aplicar el esquema en la base de producción.

(El envío también sale como «—» hasta que eliges una dirección en el mapa; eso es normal. Lo que no es normal es que falte la tarifa de servicio.)

## Cómo confirmarlo
1. En Railway, abre los *logs* del servicio y busca el error de esa llamada. Suele decir algo como `Table '…finance_settings' doesn't exist` o `Unknown column '…'`.
2. O, con `DATABASE_URL` apuntando a producción (por ejemplo `railway run npm run db:check-schema`):
   ```bash
   npm run db:check-schema
   ```
   Solo lee. Lista las tablas y columnas que el código usa y la base no tiene.

## Cómo arreglarlo
1. **Haz una copia de seguridad** de la base.
2. Aplica el esquema (en este proyecto se ha usado `npm run db:push`; ver README para el flujo de migraciones). Revisa el diff que muestre `drizzle-kit` y **no aceptes renombrados ni eliminaciones** de columnas existentes.
3. Vuelve a ejecutar `npm run db:check-schema`: debe decir que no falta nada.
4. Recarga el carrito. Si no hay ninguna fila en `finance_settings`, la app usa la tarifa de servicio de lanzamiento (0,45) hasta que el admin guarde la configuración en Finanzas.

Si después de esto sigue el 500, el log de Railway dirá la causa real; pásala para revisarla.
