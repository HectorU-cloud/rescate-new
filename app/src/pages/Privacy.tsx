import { Link } from "react-router";
import { ContactLine, LegalLayout } from "@/components/LegalLayout";
import { LEGAL } from "@/lib/legal";

export default function Privacy() {
  return (
    <LegalLayout title="Política de privacidad">
      <p>
        {LEGAL.name} («nosotros») conecta a clientes, comercios y repartidores de Milagro y alrededores. Esta política explica qué datos personales
        tratamos, para qué, con quién los compartimos y cómo puedes ejercer tus derechos conforme a la Ley Orgánica de Protección de Datos
        Personales del Ecuador (LOPDP).
      </p>

      <h2>1. Responsable y contacto</h2>
      <p>
        El responsable del tratamiento es {LEGAL.name}. Para cualquier consulta o para ejercer tus derechos escríbenos a <ContactLine />.
      </p>

      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li><b>Cuenta:</b> nombre, correo electrónico, contraseña (guardada cifrada, nunca en texto) o identificador de tu cuenta de Google, y foto de perfil de Google si la hay.</li>
        <li><b>Contacto y entrega:</b> teléfono, direcciones guardadas, dirección de entrega, coordenadas del destino (si las compartes) y notas del pedido.</li>
        <li><b>Pedidos:</b> productos, montos, estado, códigos de retiro/entrega, historial de eventos, calificaciones, comentarios y reclamos.</li>
        <li><b>Chat:</b> mensajes entre cliente y repartidor durante un pedido.</li>
        <li><b>Repartidores:</b> foto, vehículo, placa, presentación y ubicación GPS en vivo mientras llevan un pedido activo.</li>
        <li><b>Comercios:</b> nombre, dirección, ubicación en el mapa, teléfono, horarios, productos e imágenes.</li>
        <li><b>Técnicos:</b> dirección IP (para limitar intentos de acceso y prevenir abusos), cookie de sesión y, si activas las notificaciones, un identificador de tu dispositivo.</li>
      </ul>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Crear tu cuenta, autenticarte y mantener tu sesión.</li>
        <li>Gestionar pedidos: mostrar al comercio y al repartidor lo necesario para preparar y entregar. Al repartidor se le oculta tu nombre completo, teléfono y datos extra hasta que corresponde.</li>
        <li>Calcular tarifas y tiempos estimados con distancias y ubicación.</li>
        <li>Enviarte avisos del estado de tus pedidos (notificaciones push y correos de verificación o recuperación de contraseña).</li>
        <li>Verificar repartidores y comercios, atender reclamos y prevenir fraudes o abusos.</li>
        <li>Cumplir obligaciones legales y contables.</li>
      </ul>
      <p>
        La base de estos tratamientos es tu consentimiento al registrarte y usar el servicio, la ejecución del servicio que solicitas y nuestro
        interés legítimo en la seguridad de la plataforma. No vendemos tus datos ni los usamos para publicidad de terceros.
      </p>

      <h2>4. Ubicación</h2>
      <p>
        Solo usamos tu ubicación cuando tú lo autorizas en el navegador: para marcar tu local, calcular tu entrega o, en el caso de repartidores,
        mostrar al cliente por dónde va su pedido. El GPS del repartidor se comparte únicamente con el cliente del pedido en curso y se reemplaza
        con cada actualización; no guardamos un historial de recorridos. Puedes retirar el permiso en cualquier momento desde tu navegador.
      </p>

      <h2>5. Con quién los compartimos</h2>
      <p>Compartimos datos solo con quien interviene en tu pedido y con proveedores que nos prestan servicios:</p>
      <ul>
        <li><b>Comercio y repartidor</b> del pedido, con la información necesaria para cumplirlo.</li>
        <li><b>Proveedores tecnológicos:</b> alojamiento de la aplicación y la base de datos (Vercel y Railway), almacenamiento de imágenes (Cloudflare R2 o Amazon S3), notificaciones push (Google Firebase), inicio de sesión (Google), envío de correos (Resend) y mapas (proveedor de teselas configurado).</li>
        <li><b>Autoridades</b>, cuando una ley o una orden válida lo exija.</li>
      </ul>
      <p>Algunos de estos proveedores están fuera del Ecuador; trabajamos con ellos bajo sus condiciones de protección de datos.</p>

      <h2>6. Cuánto tiempo los conservamos</h2>
      <p>
        Conservamos tu cuenta mientras la uses. Si la eliminas, borramos o anonimizamos tus datos personales de inmediato (ver sección 7). En ese caso, tus
        pedidos ya finalizados se conservan sin tus datos personales, solo con montos y fechas, porque el comercio y la plataforma los necesitan para su
        contabilidad y para atender reclamos.
      </p>

      <h2>7. Tus derechos</h2>
      <p>Tienes derecho a acceso, rectificación y actualización, eliminación, oposición, limitación del tratamiento y portabilidad de tus datos, y a no ser objeto de decisiones basadas únicamente en tratamientos automatizados.</p>
      <ul>
        <li><b>Rectificar:</b> edita tu nombre, teléfono y direcciones desde <Link className="underline" to="/perfil">Perfil</Link>.</li>
        <li><b>Eliminar:</b> en <Link className="underline" to="/perfil">Perfil</Link> → «Eliminar mi cuenta». Borra tu nombre, correo, teléfono, contraseña, foto, direcciones guardadas, dispositivos de notificación y los textos que escribiste (chat, reclamos, comentarios), y anonimiza tus pedidos. No es posible con pedidos en curso. Si eres dueño de un comercio, este dejará de publicarse.</li>
        <li><b>Acceso, oposición, limitación o portabilidad:</b> escríbenos a <ContactLine /> y responderemos dentro de los plazos legales.</li>
      </ul>
      <p>Si consideras que tus derechos no fueron atendidos, puedes acudir a la Superintendencia de Protección de Datos Personales del Ecuador.</p>

      <h2>8. Cookies y almacenamiento local</h2>
      <p>
        Usamos una cookie de sesión estrictamente necesaria para mantenerte conectado y almacenamiento local del navegador para recordar tu carrito y
        tus preferencias de notificaciones. No usamos cookies de publicidad ni de seguimiento.
      </p>

      <h2>9. Seguridad</h2>
      <p>
        Las contraseñas se guardan cifradas, la conexión es HTTPS, limitamos los intentos de acceso y restringimos qué datos ve cada rol. Ningún sistema
        es infalible: si ocurriera una brecha que te afecte, te lo comunicaremos conforme a la ley.
      </p>

      <h2>10. Menores de edad</h2>
      <p>El servicio está dirigido a mayores de 18 años. Si detectamos una cuenta de un menor sin autorización de su representante, la eliminaremos.</p>

      <h2>11. Cambios</h2>
      <p>Si cambiamos esta política publicaremos la nueva versión aquí con su fecha de actualización y, si el cambio es importante, te avisaremos en la aplicación.</p>
    </LegalLayout>
  );
}
