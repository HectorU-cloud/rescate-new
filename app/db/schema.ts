import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
  varchar,
  text,
  mediumtext,
  timestamp,
  boolean,
  int,
  double,
  index,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // Rol dentro de la app de delivery: cliente, comercio o repartidor
  appRole: mysqlEnum("appRole", ["customer", "business", "courier"]),
  phone: varchar("phone", { length: 30 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// Comercios de Milagro
// ---------------------------------------------------------------------------
export const businesses = mysqlTable(
  "businesses",
  {
    id: serial("id").primaryKey(),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 60 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    lat: double("lat").notNull(),
    lng: double("lng").notNull(),
    phone: varchar("phone", { length: 30 }),
    emoji: varchar("emoji", { length: 8 }).default("🍽️").notNull(),
    isOpen: boolean("isOpen").default(true).notNull(),
    deliveryFee: double("deliveryFee").default(1).notNull(),
    deliveryMinutes: int("deliveryMinutes").default(30).notNull(),
    rating: double("rating").default(4.5).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    ownerIdx: index("biz_owner_idx").on(t.ownerId),
    categoryIdx: index("biz_category_idx").on(t.category),
  }),
);

export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = typeof businesses.$inferInsert;

// ---------------------------------------------------------------------------
// Productos del catálogo (delivery normal)
// ---------------------------------------------------------------------------
export const products = mysqlTable(
  "products",
  {
    id: serial("id").primaryKey(),
    businessId: bigint("businessId", { mode: "number", unsigned: true })
      .notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    description: varchar("description", { length: 300 }),
    // Imagen comprimida en data URL para MVP. Migrar a object storage al escalar.
    imageUrl: mediumtext("imageUrl"),
    price: double("price").notNull(),
    emoji: varchar("emoji", { length: 8 }).default("🍽️").notNull(),
    isAvailable: boolean("isAvailable").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ bizIdx: index("prod_biz_idx").on(t.businessId) }),
);

export type Product = typeof products.$inferSelect;

// ---------------------------------------------------------------------------
// Packs de rescate (comida con descuento al final del día) — el diferenciador
// ---------------------------------------------------------------------------
export const rescuePacks = mysqlTable(
  "rescue_packs",
  {
    id: serial("id").primaryKey(),
    businessId: bigint("businessId", { mode: "number", unsigned: true })
      .notNull(),
    title: varchar("title", { length: 150 }).notNull(),
    description: varchar("description", { length: 300 }),
    originalPrice: double("originalPrice").notNull(),
    rescuePrice: double("rescuePrice").notNull(),
    quantityTotal: int("quantityTotal").notNull(),
    quantityLeft: int("quantityLeft").notNull(),
    pickupStart: varchar("pickupStart", { length: 5 }).notNull(), // "19:00"
    pickupEnd: varchar("pickupEnd", { length: 5 }).notNull(), // "20:30"
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ bizIdx: index("pack_biz_idx").on(t.businessId) }),
);

export type RescuePack = typeof rescuePacks.$inferSelect;

// ---------------------------------------------------------------------------
// Pedidos (delivery a domicilio o rescate con retiro en local)
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = [
  "pending", // recién creado, espera al comercio
  "accepted", // comercio aceptó
  "preparing", // en cocina
  "ready", // listo: espera repartidor (delivery) o cliente (rescate)
  "picked_up", // repartidor en camino (delivery)
  "delivered", // entregado / retirado
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orders = mysqlTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 20 }).notNull().unique(),
    type: mysqlEnum("type", ["delivery", "rescue"]).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "accepted",
      "preparing",
      "ready",
      "picked_up",
      "delivered",
      "cancelled",
    ])
      .default("pending")
      .notNull(),
    customerId: bigint("customerId", { mode: "number", unsigned: true })
      .notNull(),
    businessId: bigint("businessId", { mode: "number", unsigned: true })
      .notNull(),
    courierId: bigint("courierId", { mode: "number", unsigned: true }),
    subtotal: double("subtotal").notNull(),
    deliveryFee: double("deliveryFee").default(0).notNull(),
    total: double("total").notNull(),
    paymentMethod: mysqlEnum("paymentMethod", ["cash"]).default("cash")
      .notNull(),
    deliveryAddress: varchar("deliveryAddress", { length: 300 }),
    notes: varchar("notes", { length: 300 }),
    pickupCode: varchar("pickupCode", { length: 6 }), // validación de retiro
    customerName: varchar("customerName", { length: 150 }),
    customerPhone: varchar("customerPhone", { length: 30 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    customerIdx: index("ord_customer_idx").on(t.customerId),
    bizIdx: index("ord_biz_idx").on(t.businessId),
    courierIdx: index("ord_courier_idx").on(t.courierId),
    statusIdx: index("ord_status_idx").on(t.status),
  }),
);

export type Order = typeof orders.$inferSelect;

export const orderItems = mysqlTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
    productId: bigint("productId", { mode: "number", unsigned: true }),
    rescuePackId: bigint("rescuePackId", { mode: "number", unsigned: true }),
    name: varchar("name", { length: 150 }).notNull(),
    unitPrice: double("unitPrice").notNull(),
    quantity: int("quantity").notNull(),
  },
  (t) => ({ orderIdx: index("item_order_idx").on(t.orderId) }),
);

export type OrderItem = typeof orderItems.$inferSelect;


// Última ubicación conocida del repartidor por pedido activo.
// Se conserva un único punto por pedido para no acumular trayectos innecesarios.
export const courierLocations = mysqlTable("courier_locations", {
  orderId: bigint("orderId", { mode: "number", unsigned: true }).primaryKey(),
  courierId: bigint("courierId", { mode: "number", unsigned: true }).notNull(),
  lat: double("lat").notNull(),
  lng: double("lng").notNull(),
  accuracy: double("accuracy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type CourierLocation = typeof courierLocations.$inferSelect;
