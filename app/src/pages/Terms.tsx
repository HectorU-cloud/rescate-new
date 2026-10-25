import { Link } from "react-router";
import { ContactLine, LegalLayout } from "@/components/LegalLayout";
import { LEGAL } from "@/lib/legal";

export default function Terms() {
  return (
    <LegalLayout title="Términos de servicio">
      <p>
        Al crear una cuenta o usar {LEGAL.name} aceptas estos términos y la <Link className="underline" to="/privacidad">Política de privacidad</Link>.
      </p>

      <h2>1. Qué es el servicio</h2>
      <p>
        {LEGAL.name} es una plataforma que pone en contacto a clientes, comercios y repartidores independientes. Los comercios son responsables de sus
        productos, precios, calidad e higiene; los repartidores, de la entrega. La plataforma no elabora ni vende los productos.
      </p>

      <h2>2. Cuenta</h2>
      <ul>
        <li>Debes ser mayor de 18 años y dar datos verdaderos. Eres responsable de lo que se haga con tu cuenta y de mantener tu contraseña en secreto.</li>
        <li>Los comercios y repartidores pasan por una revisión antes de aparecer o recibir pedidos, y podemos suspender cuentas que incumplan estas reglas.</li>
      </ul>

      <h2>3. Pedidos y pagos</h2>
      <ul>
        <li>El pago se realiza en efectivo, directamente al comercio o al repartidor, según el tipo de pedido.</li>
        <li>Los packs de rescate son productos con descuento, de cantidad limitada y con ventana de retiro; si no los retiras a tiempo pueden cancelarse.</li>
        <li>Los códigos de retiro y de entrega son personales: no los compartas con quien no esté en tu pedido.</li>
        <li>Los tiempos y distancias mostrados son estimaciones.</li>
      </ul>

      <h2>4. Conducta</h2>
      <p>No se permite suplantar identidades, usar la plataforma para fraudes, acosar a otras personas, subir contenido ilegal u ofensivo ni intentar vulnerar su seguridad.</p>

      <h2>5. Reclamos</h2>
      <p>Si tienes un problema con un pedido, puedes abrir un reclamo desde el detalle del pedido. El equipo lo revisará y responderá dentro de la aplicación.</p>

      <h2>6. Responsabilidad</h2>
      <p>Hacemos lo posible por mantener el servicio disponible, pero puede haber interrupciones. En la medida que la ley lo permita, no respondemos por los actos de comercios o repartidores independientes ni por daños indirectos.</p>

      <h2>7. Cambios y contacto</h2>
      <p>Podemos actualizar estos términos; el uso continuado implica aceptarlos. Escríbenos a <ContactLine /> para cualquier consulta.</p>
    </LegalLayout>
  );
}
