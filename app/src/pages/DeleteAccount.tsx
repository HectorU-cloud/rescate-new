import { Link } from "react-router";
import { ContactLine, LegalLayout } from "@/components/LegalLayout";
import { LEGAL } from "@/lib/legal";

/**
 * Página pública (sin iniciar sesión) que explica cómo eliminar la cuenta y los datos.
 * Google Play pide una URL pública con estas instrucciones además del botón dentro de la app.
 * Debe coincidir con server/lib/account-deletion.ts y con la sección 7 de la política de privacidad.
 */
export default function DeleteAccount() {
  return (
    <LegalLayout title="Cómo eliminar tu cuenta y tus datos">
      <p>
        Puedes eliminar tu cuenta de {LEGAL.name} cuando quieras, sea que uses la aplicación en el teléfono o el sitio web. Esta página explica cómo
        hacerlo, qué se borra y qué se conserva.
      </p>

      <h2>Si puedes entrar a tu cuenta</h2>
      <ol className="ml-5 list-decimal space-y-1">
        <li>Inicia sesión en {LEGAL.name}.</li>
        <li>Abre <Link className="underline" to="/perfil">Perfil</Link>.</li>
        <li>Al final de la pantalla toca <b>«Eliminar mi cuenta»</b>.</li>
        <li>Escribe la palabra <b>ELIMINAR</b> para confirmar. La eliminación es inmediata y no se puede deshacer.</li>
      </ol>

      <h2>Si no puedes entrar a tu cuenta</h2>
      <p>
        Escríbenos a <ContactLine /> desde el correo con el que te registraste, indicando que quieres eliminar tu cuenta. Podemos pedirte datos para
        comprobar que eres la persona titular y responderemos dentro de los plazos legales.
      </p>

      <h2>Qué se borra</h2>
      <ul>
        <li>Tu nombre, correo electrónico, teléfono, contraseña y foto.</li>
        <li>Tus direcciones guardadas y los dispositivos registrados para notificaciones.</li>
        <li>Tu ubicación de repartidor, si la tenías.</li>
        <li>Los textos que escribiste: mensajes de chat, reclamos y comentarios.</li>
      </ul>

      <h2>Qué se conserva</h2>
      <p>
        Tus pedidos ya finalizados se conservan <b>sin tus datos personales</b>, solo con montos y fechas, porque el comercio y la plataforma los
        necesitan para su contabilidad y para atender reclamos. Si vuelves a registrarte con el mismo correo o con Google, se crea una cuenta nueva
        sin relación con la anterior.
      </p>

      <h2>Limitaciones</h2>
      <ul>
        <li>No se puede eliminar la cuenta mientras tengas pedidos en curso: espera a que terminen o se cancelen.</li>
        <li>Si eres dueño de un comercio, este dejará de publicarse al eliminar la cuenta.</li>
        <li>Las cuentas de administrador no se eliminan desde la app; escríbenos si necesitas hacerlo.</li>
      </ul>

      <p>
        Más detalles sobre tus datos y tus derechos en la <Link className="underline" to="/privacidad">política de privacidad</Link>.
      </p>
    </LegalLayout>
  );
}
