/**
 * Contenido de la guía de bienvenida (una por rol). Es solo texto: para cambiar lo que dice la guía, edita este archivo.
 * Cada dato que se explica aquí es algo que la app realmente hace; si cambias una regla del producto, revisa su paso.
 */
export type TourRole = "customer" | "business" | "courier";

export type TourStep = {
  emoji: string;
  title: string;
  body: string;
  bullets?: string[];
};

export type TourFinish = {
  title: string;
  body: string;
  /** Texto del botón final. */
  cta: string;
  /** A dónde lleva el botón final (si no se indica, solo cierra la guía). */
  goTo?: string;
};

export const TOUR_STEPS: Record<TourRole, TourStep[]> = {
  customer: [
    {
      emoji: "🌱",
      title: "Bienvenido a Rescate",
      body: "Aquí rescatas comida rica de locales de tu ciudad antes de que se desperdicie, y pagas menos. Te mostramos cómo funciona en menos de un minuto.",
    },
    {
      emoji: "🧡",
      title: "Rescates: packs a menor precio",
      body: "Cerca de la hora de cierre, los locales publican packs con comida del día a un precio más bajo.",
      bullets: [
        "Reserva el pack que quieras en la sección Rescate.",
        "Lo retiras tú en el local, con tu código de retiro de 6 dígitos.",
        "Pagas en efectivo al retirar.",
      ],
    },
    {
      emoji: "🍽️",
      title: "Pide del menú de los locales",
      body: "También puedes pedir lo que quieras del menú de cada local.",
      bullets: [
        "Elige entre domicilio (un repartidor te lo lleva) o retiro en el local.",
        "Antes de confirmar ves el total completo: productos, envío y tarifa de servicio.",
        "Pagas en efectivo al recibir o al retirar.",
      ],
    },
    {
      emoji: "📍",
      title: "Elige tu ciudad",
      body: "Con el botón de ciudad (arriba, en Inicio y en Rescates) eliges de qué ciudad ver los locales. Puedes cambiarla cuando quieras.",
    },
    {
      emoji: "🔐",
      title: "Sigue tu pedido y usa tus códigos",
      body: "En Pedidos ves cada paso de tu pedido en vivo.",
      bullets: [
        "Cuando el repartidor llegue, dile tu código de entrega de 6 dígitos.",
        "Dilo solo en persona: nunca lo escribas en el chat.",
        "Mientras tu pedido va en camino, puedes chatear con el repartidor.",
      ],
    },
    {
      emoji: "⭐",
      title: "Califica y pide ayuda",
      body: "Al recibir tu pedido, califica al local y al repartidor. Si algo salió mal, abre un reclamo desde el pedido y lo revisamos.",
    },
  ],
  business: [
    {
      emoji: "🍽️",
      title: "Bienvenido a tu panel",
      body: "Desde aquí recibes pedidos, publicas tu menú y rescatas lo que te sobra. Te mostramos lo básico.",
    },
    {
      emoji: "🧾",
      title: "Pedidos",
      body: "Los pedidos llegan a la pestaña Pedidos, con un aviso y un sonido.",
      bullets: [
        "Acéptalo, ponlo en preparación y márcalo como listo.",
        "Si un pedido a domicilio se queda sin avanzar, te lo recordamos a los 25 minutos y se cancela solo a los 60.",
        "Activa las notificaciones en tu Perfil para no perder pedidos con la app cerrada.",
      ],
    },
    {
      emoji: "🧡",
      title: "Menú y rescates",
      body: "En Menú cargas tus productos y precios. En Rescate publicas packs con lo que te sobra antes de cerrar, a un precio más bajo, indicando cuántos hay y hasta qué hora se retiran.",
    },
    {
      emoji: "🔐",
      title: "Códigos de entrega",
      body: "Cada entrega se confirma con un código de 6 dígitos.",
      bullets: [
        "En un rescate, el cliente te muestra su código de retiro: escríbelo para entregar el pack.",
        "En un pedido a domicilio, tú ves el código de retiro en el pedido y se lo das al repartidor cuando llega.",
      ],
    },
    {
      emoji: "📌",
      title: "Mantén tus datos al día",
      body: "Si cambias el nombre, la dirección o mueves tu ubicación en el mapa, el cambio pasa por una revisión antes de publicarse. Hazlo con calma y revisa que tu pin esté bien puesto.",
    },
    {
      emoji: "⭐",
      title: "Reseñas y estado de cuenta",
      body: "En Reseñas ves lo que opinan tus clientes. En tu panel también está tu estado de cuenta, con lo pendiente con Rescate y tus pagos.",
    },
  ],
  courier: [
    {
      emoji: "🛵",
      title: "Bienvenido, repartidor",
      body: "Aquí tomas pedidos de los locales de tu ciudad y los llevas a los clientes. Te mostramos cómo funciona.",
    },
    {
      emoji: "📍",
      title: "Elige tu ciudad de trabajo",
      body: "Solo verás —y recibirás avisos de— los pedidos de los locales de la ciudad que elijas. Si te mueves a otra, cámbiala con el botón de ciudad de tu panel.",
    },
    {
      emoji: "🟢",
      title: "Conéctate",
      body: "Activa tu disponibilidad en el panel, y las notificaciones en tu Perfil, para que te avisemos cuando haya pedidos listos en tu ciudad.",
    },
    {
      emoji: "📦",
      title: "Toma y recoge el pedido",
      body: "En Disponibles, toma un pedido: queda reservado para ti y tienes 15 minutos para recogerlo.",
      bullets: [
        "Ve al local y pídele el código de retiro de 6 dígitos.",
        "Escríbelo en la app para confirmar que ya lo recogiste.",
      ],
    },
    {
      emoji: "✅",
      title: "Entrega con el código del cliente",
      body: "Al llegar con el cliente, pídele su código de confirmación de 6 dígitos y escríbelo para cerrar la entrega. Mientras vas en camino puedes chatear con él.",
    },
    {
      emoji: "💵",
      title: "Ganancias y estado de cuenta",
      body: "El envío de cada pedido es tuyo: lo ves en Ganancias. En tu estado de cuenta ves lo que debes a Rescate y tus pagos.",
    },
  ],
};

export const TOUR_FINISH: Record<TourRole, TourFinish> = {
  customer: {
    title: "¿Entendiste todo?",
    body: "¡Listo! Ya sabes cómo funciona Rescate. Si quieres repasarlo, puedes volver a ver esta guía desde tu Perfil.",
    cta: "¡Sí, comencemos esos rescates! 🧡",
    goTo: "/rescate",
  },
  business: {
    title: "¿Todo claro?",
    body: "¡Listo! Ya conoces tu panel. Si quieres repasarlo, puedes volver a ver esta guía desde tu Perfil.",
    cta: "¡Sí, a vender! 🍽️",
  },
  courier: {
    title: "¿Todo claro?",
    body: "¡Listo! Ya sabes cómo repartir con Rescate. Si quieres repasarlo, puedes volver a ver esta guía desde tu Perfil.",
    cta: "¡Sí, a repartir! 🛵",
  },
};

/** Pantalla principal de cada rol: ahí aparece la guía y a ahí se vuelve para repetirla. */
export const TOUR_LANDING: Record<TourRole, string> = { customer: "/", business: "/panel", courier: "/repartidor" };

/** El rol de la app → la guía que le toca (el admin y quien aún no eligió rol no tienen guía). */
export function tourRoleFor(appRole: string | null | undefined): TourRole | null {
  return appRole === "customer" || appRole === "business" || appRole === "courier" ? appRole : null;
}
