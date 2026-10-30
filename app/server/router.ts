import { adminRouter } from "./admin-router";
import { authRouter } from "./auth-router";
import { businessRouter } from "./business-router";
import { catalogRouter } from "./catalog-router";
import { chatRouter } from "./chat-router";
import { courierRouter } from "./courier-router";
import { notificationsRouter } from "./notifications-router";
import { ordersRouter } from "./orders-router";
import { profileRouter } from "./profile-router";
import { pushRouter } from "./push-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  profile: profileRouter,
  push: pushRouter,
  notifications: notificationsRouter,
  catalog: catalogRouter,
  orders: ordersRouter,
  chat: chatRouter,
  business: businessRouter,
  courier: courierRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
