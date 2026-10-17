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
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  // Único: dos cuentas con el mismo correo hacían ambiguo el inicio de sesión y la recuperación
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  // Sube al cambiar la contraseña o al cerrar sesión en todos los dispositivos; invalida las sesiones anteriores
  sessionVersion: int("sessionVersion").default(0).notNull(),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // Rol dentro de la app de delivery: cliente, comercio o repartidor
  appRole: mysqlEnum("appRole", ["customer", "business", "courier"]),
  phone: varchar("phone", { length: 30 }),
  courierPhotoUrl: text("courierPhotoUrl"),
  courierVehicle: varchar("courierVehicle", { length: 80 }),
  courierPlate: varchar("courierPlate", { length: 20 }),
  courierBio: varchar("courierBio", { length: 300 }),
  courierApproved: boolean("courierApproved").default(false).notNull(),
  // Revisión manual del perfil: pending → approved | rejected (con nota visible para el repartidor)
  courierVerification: mysqlEnum("courierVerification", ["pending", "approved", "rejected"]).default("pending").notNull(),
  courierReviewNote: varchar("courierReviewNote", { length: 300 }),
  // El repartidor decide si quiere recibir avisos de pedidos nuevos
  courierAvailable: boolean("courierAvailable").default(true).notNull(),
  // Calificación del repartidor (null hasta su primera calificación)
  courierRating: double("courierRating"),
  courierRatingCount: int("courierRatingCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});


// Direcciones guardadas por cada cliente para agilizar futuras compras.
export const customerAddresses = mysqlTable(
  "customer_addresses",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    label: varchar("label", { length: 60 }).notNull().default("Casa"),
    address: varchar("address", { length: 300 }).notNull(),
    lat: double("lat").notNull(),
    lng: double("lng").notNull(),
    isDefault: boolean("isDefault").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ userIdx: index("customer_address_user_idx").on(t.userId) }),
);

export type CustomerAddress = typeof customerAddresses.$inferSelect;

export const authTokens = mysqlTable("auth_tokens", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  purpose: mysqlEnum("purpose", ["verify_email", "reset_password"]).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({ userIdx: index("auth_token_user_idx").on(t.userId) }));

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
    // Tarifa de envío = deliveryFee (base) + feePerKm × distancia estimada
    deliveryFee: double("deliveryFee").default(1).notNull(),
    feePerKm: double("feePerKm").default(0.25).notNull(),
    deliveryRadiusKm: double("deliveryRadiusKm").default(5).notNull(),
    minOrder: double("minOrder").default(0).notNull(),
    // Horario de atención en hora de Ecuador (HH:MM). Si cierra antes de abrir, cruza la medianoche.
    opensAt: varchar("opensAt", { length: 5 }).default("08:00").notNull(),
    closesAt: varchar("closesAt", { length: 5 }).default("22:00").notNull(),
    // Los comercios nuevos entran como "pending" y no se muestran hasta que un admin los apruebe.
    approvalStatus: mysqlEnum("approvalStatus", ["pending", "approved", "rejected"]).default("approved").notNull(),
    approvalNote: varchar("approvalNote", { length: 300 }),
    // El dueño marcó el punto exacto de su local en el mapa (tarifa por km, radio y navegación dependen de él)
    locationConfirmed: boolean("locationConfirmed").default(false).notNull(),
    deliveryMinutes: int("deliveryMinutes").default(30).notNull(),
    rating: double("rating").default(4.5).notNull(),
    // Cantidad de calificaciones reales que respaldan el rating (0 = aún sin calificaciones)
    ratingCount: int("ratingCount").default(0).notNull(),
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
    // MVP: imagen comprimida; usar object storage para producción.
    imageUrl: mediumtext("imageUrl"),
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
    // Coordenadas opcionales del destino para calcular una ETA aproximada.
    deliveryLat: double("deliveryLat"),
    deliveryLng: double("deliveryLng"),
    notes: varchar("notes", { length: 300 }),
    pickupCode: varchar("pickupCode", { length: 6 }), // validación de retiro de packs
    deliveryConfirmationCode: varchar("deliveryConfirmationCode", { length: 6 }), // código privado para confirmar delivery
    customerName: varchar("customerName", { length: 150 }),
    customerPhone: varchar("customerPhone", { length: 30 }),
    // Distancia estimada comercio → cliente usada para calcular la tarifa
    deliveryDistanceKm: double("deliveryDistanceKm"),
    // Momento en que quedó "listo" (para el tiempo límite de espera de repartidor)
    readyAt: timestamp("readyAt"),
    courierReminderSentAt: timestamp("courierReminderSentAt"),
    // Intentos fallidos al confirmar el código de entrega (delivery) o de retiro (rescate)
    codeAttempts: int("codeAttempts").default(0).notNull(),
    // Recordatorio al comercio cuando un delivery aceptado/en cocina no avanza (se reinicia al cambiar de estado)
    businessReminderSentAt: timestamp("businessReminderSentAt"),
    courierAcceptedAt: timestamp("courierAcceptedAt"),
    deliveredAt: timestamp("deliveredAt"),
    cancelledBy: mysqlEnum("cancelledBy", ["customer", "business", "admin", "system"]),
    cancelReason: varchar("cancelReason", { length: 300 }),
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

// Dispositivos autorizados para recibir notificaciones push. Un token puede renovarse.
export const pushTokens = mysqlTable(
  "push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    token: varchar("token", { length: 700 }).notNull().unique(),
    platform: mysqlEnum("platform", ["web", "android", "ios"]).default("web").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (t) => ({ userIdx: index("push_user_idx").on(t.userId) }),
);

export type PushToken = typeof pushTokens.$inferSelect;


// Historial de eventos del pedido (auditoría): quién hizo qué y cuándo.
export const orderEvents = mysqlTable(
  "order_events",
  {
    id: serial("id").primaryKey(),
    orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
    actorId: bigint("actorId", { mode: "number", unsigned: true }),
    actorRole: varchar("actorRole", { length: 20 }).notNull(), // customer | business | courier | admin | system
    type: varchar("type", { length: 40 }).notNull(), // status:ready, courier_released, expired, admin_cancel...
    detail: varchar("detail", { length: 300 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ orderIdx: index("evt_order_idx").on(t.orderId) }),
);

export type OrderEvent = typeof orderEvents.$inferSelect;

// Chat entre el cliente y el repartidor asignado mientras el pedido va en camino.
// `courierId` identifica el hilo: si el pedido se reasigna a otro repartidor, el nuevo
// no ve los mensajes del anterior (y el cliente empieza una conversación limpia).
export const orderMessages = mysqlTable(
  "order_messages",
  {
    id: serial("id").primaryKey(),
    orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
    courierId: bigint("courierId", { mode: "number", unsigned: true }).notNull(),
    senderId: bigint("senderId", { mode: "number", unsigned: true }).notNull(),
    senderRole: mysqlEnum("senderRole", ["customer", "courier"]).notNull(),
    body: varchar("body", { length: 500 }).notNull(),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({ orderIdx: index("msg_order_idx").on(t.orderId, t.id) }),
);

export type OrderMessage = typeof orderMessages.$inferSelect;

// Reclamos de clientes, comercios o repartidores sobre un pedido.
export const claims = mysqlTable(
  "claims",
  {
    id: serial("id").primaryKey(),
    orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    reporterRole: mysqlEnum("reporterRole", ["customer", "business", "courier"]).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: mysqlEnum("status", ["open", "resolved", "rejected"]).default("open").notNull(),
    resolution: varchar("resolution", { length: 500 }),
    resolvedBy: bigint("resolvedBy", { mode: "number", unsigned: true }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    resolvedAt: timestamp("resolvedAt"),
  },
  (t) => ({
    orderIdx: index("claim_order_idx").on(t.orderId),
    statusIdx: index("claim_status_idx").on(t.status),
  }),
);

export type Claim = typeof claims.$inferSelect;

// Calificación del cliente tras la entrega: una por pedido, al comercio y (si hubo) al repartidor.
export const ratings = mysqlTable(
  "ratings",
  {
    id: serial("id").primaryKey(),
    orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
    customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
    businessId: bigint("businessId", { mode: "number", unsigned: true }).notNull(),
    courierId: bigint("courierId", { mode: "number", unsigned: true }),
    businessStars: int("businessStars").notNull(), // 1–5
    businessComment: varchar("businessComment", { length: 300 }),
    courierStars: int("courierStars"), // 1–5, solo si hubo repartidor
    courierComment: varchar("courierComment", { length: 300 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    orderUq: uniqueIndex("rating_order_uq").on(t.orderId),
    bizIdx: index("rating_biz_idx").on(t.businessId),
    courierIdx: index("rating_courier_idx").on(t.courierId),
  }),
);

export type Rating = typeof ratings.$inferSelect;
