/**
 * Datos demo de "Al Rescate" en Milagro, Ecuador.
 * Ejecutar con: npx tsx db/seed.ts
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import {
  businesses,
  orderItems,
  orders,
  products,
  ratings,
  rescuePacks,
  users,
} from "./schema";
import { eq, like } from "drizzle-orm";

const DEMO_PREFIX = "demo-owner-";

async function main() {
  const db = getDb();

  // Limpieza idempotente de datos demo (un dueño por comercio)
  const demoUsers = await db
    .select()
    .from(users)
    .where(like(users.unionId, `${DEMO_PREFIX}%`));
  const legacy = await db.query.users.findFirst({
    where: eq(users.unionId, "demo-owner-milagro"),
  });
  if (legacy) demoUsers.push(legacy);

  for (const demoUser of demoUsers) {
    const bizRows = await db
      .select()
      .from(businesses)
      .where(eq(businesses.ownerId, demoUser.id));
    for (const b of bizRows) {
      const ords = await db
        .select()
        .from(orders)
        .where(eq(orders.businessId, b.id));
      for (const o of ords) {
        await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
        await db.delete(ratings).where(eq(ratings.orderId, o.id));
      }
      await db.delete(orders).where(eq(orders.businessId, b.id));
      await db.delete(products).where(eq(products.businessId, b.id));
      await db.delete(rescuePacks).where(eq(rescuePacks.businessId, b.id));
      await db.delete(businesses).where(eq(businesses.id, b.id));
    }
    await db.delete(users).where(eq(users.id, demoUser.id));
  }
  // Borra pedidos demo viejos por código
  for (const prefix of ["AR-%", "RS-%"]) {
    const oldOrders = await db
      .select()
      .from(orders)
      .where(like(orders.code, prefix));
    for (const o of oldOrders) {
      await db.delete(orderItems).where(eq(orderItems.orderId, o.id));
      await db.delete(ratings).where(eq(ratings.orderId, o.id));
      await db.delete(orders).where(eq(orders.id, o.id));
    }
  }

  const bizData = [
    {
      name: "Panadería El Trigal",
      description: "Pan fresco, bizcochos y dulces de toda la vida, frente al parque central.",
      category: "panaderia",
      address: "Av. Jaime Roldós Aguilera y García Moreno, Milagro",
      lat: -2.1335, lng: -79.5931, emoji: "🥖",
      deliveryFee: 1, deliveryMinutes: 25, rating: 4.7,
    },
    {
      name: "Pollos Asados El Campeón",
      description: "El pollo broaster más pedido de Milagro, con papas y arroz moro.",
      category: "comida-rapida",
      address: "Calle 9 de Octubre 412, Milagro",
      lat: -2.1352, lng: -79.5958, emoji: "🍗",
      deliveryFee: 1.5, deliveryMinutes: 35, rating: 4.5,
    },
    {
      name: "Cevichería La Perla del Guayas",
      description: "Ceviches, encebollado y arroz marinero estilo Guayas.",
      category: "mariscos",
      address: "Cdla. El Guasmo, calle Los Pescadores, Milagro",
      lat: -2.1301, lng: -79.5902, emoji: "🦐",
      deliveryFee: 2, deliveryMinutes: 40, rating: 4.8,
    },
    {
      name: "Cafetería Aroma y Café",
      description: "Café de altura, humitas y empanadas de viento.",
      category: "cafeteria",
      address: "Malecón del río Milagro, local 3",
      lat: -2.1368, lng: -79.592, emoji: "☕",
      deliveryFee: 1, deliveryMinutes: 20, rating: 4.6,
    },
    {
      name: "Super La Esquina",
      description: "Víveres, bebidas y lo que te falte para la casa.",
      category: "supermercado",
      address: "Cdla. Paraíso del Rio, etapa 4, Milagro",
      lat: -2.1315, lng: -79.5985, emoji: "🛒",
      deliveryFee: 1.25, deliveryMinutes: 30, rating: 4.3,
    },
    {
      name: "Jugos y Batidos El Maná",
      description: "Batidos naturales de frutas del cantón: tomate de árbol, naranjilla y más.",
      category: "bebidas",
      address: "Av. Los Chirijos, junto al coliseo, Milagro",
      lat: -2.1375, lng: -79.5945, emoji: "🥤",
      deliveryFee: 0.75, deliveryMinutes: 20, rating: 4.9,
    },
    {
      name: "Pizzería Don Milagro",
      description: "Pizza artesanal al horno de leña, la favorita de los milagreños.",
      category: "comida-rapida",
      address: "Calle Quito y 24 de Mayo, Milagro",
      lat: -2.1342, lng: -79.5962, emoji: "🍕",
      deliveryFee: 1.5, deliveryMinutes: 35, rating: 4.4,
    },
  ];

  const bizIds: Record<string, number> = {};
  let n = 0;
  for (const b of bizData) {
    n += 1;
    // Un dueño por comercio: así el panel siempre muestra su propio local
    const [{ id: ownerId }] = await db
      .insert(users)
      .values({
        unionId: `${DEMO_PREFIX}${n}`,
        name: `Dueño ${b.name}`,
        email: `demo${n}@alrescate.app`,
        appRole: "business",
      })
      .$returningId();
    const [{ id }] = await db
      .insert(businesses)
      .values({ ...b, ownerId })
      .$returningId();
    bizIds[b.name] = id;
  }

  const prodData: Record<string, { name: string; description: string; price: number; emoji: string }[]> = {
    "Panadería El Trigal": [
      { name: "Pan de ambato (x4)", description: "Suavecito, recién horneado", price: 1.0, emoji: "🥖" },
      { name: "Bizcocho de queso", description: "El clásico del desayuno", price: 0.75, emoji: "🧀" },
      { name: "Torta de chocolate", description: "Porción generosa con fudge", price: 2.5, emoji: "🍰" },
      { name: "Empanada de queso", description: "Hojaldre relleno de queso", price: 1.25, emoji: "🥟" },
      { name: "Café pasado", description: "Taza grande, bien cargado", price: 0.8, emoji: "☕" },
    ],
    "Pollos Asados El Campeón": [
      { name: "1/4 pollo broaster", description: "Con papas, arroz y ensalada", price: 3.5, emoji: "🍗" },
      { name: "1/2 pollo asado", description: "Para compartir, con menestra", price: 5.5, emoji: "🍖" },
      { name: "Alitas picantes (x8)", description: "Con salsa de la casa", price: 4.0, emoji: "🔥" },
      { name: "Salchipapa campeona", description: "Papas, salchicha y salsas", price: 2.75, emoji: "🍟" },
    ],
    "Cevichería La Perla del Guayas": [
      { name: "Ceviche de camarón", description: "Con canguil y chifles", price: 6.0, emoji: "🦐" },
      { name: "Encebollado mixto", description: "El mejor para la cruda", price: 5.0, emoji: "🍲" },
      { name: "Arroz marinero", description: "Mariscos variados, abundante", price: 7.5, emoji: "🍚" },
      { name: "Corvina frita", description: "Con patacones y encurtido", price: 6.5, emoji: "🐟" },
    ],
    "Cafetería Aroma y Café": [
      { name: "Capuchino", description: "Con arte latte y canela", price: 2.0, emoji: "☕" },
      { name: "Humita de queso", description: "Receta de la abuela", price: 1.5, emoji: "🌽" },
      { name: "Empanada de viento", description: "Con azúcar por encima", price: 1.25, emoji: "🥟" },
      { name: "Sanduche de pollo", description: "Pan ciabatta tostado", price: 3.0, emoji: "🥪" },
    ],
    "Super La Esquina": [
      { name: "Arroz El Patron 5lb", description: "Fundita para la semana", price: 3.25, emoji: "🍚" },
      { name: "Cola 3L + hielo", description: "Para el almuerzo del domingo", price: 2.5, emoji: "🥤" },
      { name: "Atún Van Camps", description: "En aceite, 170g", price: 1.6, emoji: "🐟" },
      { name: "Canguil Delicia 1lb", description: "Para la película", price: 0.9, emoji: "🌽" },
      { name: "Huevos (x12)", description: "Frescos de granja", price: 2.2, emoji: "🥚" },
    ],
    "Jugos y Batidos El Maná": [
      { name: "Batido de tomate de árbol", description: "El favorito de la casa", price: 1.75, emoji: "🥤" },
      { name: "Jugo de naranjilla", description: "Natural, sin azúcar añadida", price: 1.5, emoji: "🍊" },
      { name: "Batido de guanábana", description: "En leche o en agua", price: 2.0, emoji: "🍈" },
      { name: "Limonada con hierbabuena", description: "Bien helada", price: 1.25, emoji: "🍋" },
    ],
    "Pizzería Don Milagro": [
      { name: "Pizza familiar mixta", description: "8 porciones, orilla de queso", price: 12.0, emoji: "🍕" },
      { name: "Pizza personal pepperoni", description: "Para uno (o no)", price: 4.5, emoji: "🍕" },
      { name: "Calzone de jamón", description: "Relleno de queso mozzarella", price: 3.75, emoji: "🧀" },
      { name: "Pan de ajo (x6)", description: "Con mantequilla de ajo", price: 2.0, emoji: "🥖" },
    ],
  };

  for (const [bizName, prods] of Object.entries(prodData)) {
    await db.insert(products).values(
      prods.map((p) => ({ ...p, businessId: bizIds[bizName] })),
    );
  }

  await db.insert(rescuePacks).values([
    {
      businessId: bizIds["Panadería El Trigal"],
      title: "Pack Pan del Día",
      description: "Pan surtido del día: ambato, queso y dulces. Alrededor de 12 piezas.",
      originalPrice: 6.0, rescuePrice: 2.5, quantityTotal: 8, quantityLeft: 8,
      pickupStart: "19:00", pickupEnd: "20:30",
    },
    {
      businessId: bizIds["Cafetería Aroma y Café"],
      title: "Pack Dulce Sorpresa",
      description: "Humitas y empanadas del día + una bebida caliente.",
      originalPrice: 8.0, rescuePrice: 3.0, quantityTotal: 5, quantityLeft: 5,
      pickupStart: "18:30", pickupEnd: "20:00",
    },
    {
      businessId: bizIds["Jugos y Batidos El Maná"],
      title: "Batidos del Cierre",
      description: "2 batidos grandes de las frutas que quedaron del día.",
      originalPrice: 5.0, rescuePrice: 2.0, quantityTotal: 4, quantityLeft: 4,
      pickupStart: "20:00", pickupEnd: "21:00",
    },
    {
      businessId: bizIds["Pollos Asados El Campeón"],
      title: "Pack Campeón Nocturno",
      description: "Piezas de pollo y papas que quedaron listas al cierre.",
      originalPrice: 9.0, rescuePrice: 3.5, quantityTotal: 6, quantityLeft: 6,
      pickupStart: "21:00", pickupEnd: "22:00",
    },
  ]);

  console.log("✅ Seed listo: 7 comercios, productos y 4 packs de rescate en Milagro.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
