import { authRouter } from "./auth-router";
import { businessRouter } from "./business-router";
import { catalogRouter } from "./catalog-router";
import { courierRouter } from "./courier-router";
import { ordersRouter } from "./orders-router";
import { profileRouter } from "./profile-router";
import { pushRouter } from "./push-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  profile: profileRouter,
  push: pushRouter,
  catalog: catalogRouter,
  orders: ordersRouter,
  business: businessRouter,
  courier: courierRouter,
});

export type AppRouter = typeof appRouter;
