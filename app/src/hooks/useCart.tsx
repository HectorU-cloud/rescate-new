import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { optionLineKey } from "@contracts/options";

/** Opción que el cliente eligió en un combo (sabor de la cola, tamaño de las papas, extra…). */
export type CartOption = {
  choiceId: number;
  groupName: string;
  choiceName: string;
  priceDelta: number;
};

export type CartItem = {
  /** Identifica la línea: el mismo producto con opciones distintas son líneas distintas. */
  lineKey: string;
  productId: number;
  name: string;
  /** Precio unitario YA con los adicionales de las opciones elegidas (el servidor lo vuelve a calcular). */
  price: number;
  emoji: string;
  quantity: number;
  options: CartOption[];
};

/** Lo que se pasa a `add`: la línea la arma el carrito. */
export type CartItemInput = Omit<CartItem, "quantity" | "lineKey" | "options"> & { options?: CartOption[] };

export type CartState = {
  businessId: number;
  businessName: string;
  deliveryFee: number;
  items: CartItem[];
};

type CartContextValue = {
  cart: CartState | null;
  count: number;
  subtotal: number;
  add: (
    business: { id: number; name: string; deliveryFee: number },
    item: CartItemInput,
  ) => void;
  remove: (lineKey: string) => void;
  setQty: (lineKey: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "al-rescate-cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as CartState;
      // Carritos guardados antes de las opciones de combo no traen lineKey ni options.
      return {
        ...saved,
        items: saved.items.map((i) => ({ ...i, options: i.options ?? [], lineKey: i.lineKey ?? String(i.productId) })),
      };
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (cart) localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }, [cart]);

  const add = useCallback(
    (
      business: { id: number; name: string; deliveryFee: number },
      item: CartItemInput,
    ) => {
      const options = item.options ?? [];
      const lineKey = optionLineKey(item.productId, options.map((o) => o.choiceId));
      setCart((prev) => {
        // Como las apps reales: un solo comercio por pedido
        const base: CartState =
          prev && prev.businessId === business.id
            ? prev
            : {
                businessId: business.id,
                businessName: business.name,
                deliveryFee: business.deliveryFee,
                items: [],
              };
        const existing = base.items.find((i) => i.lineKey === lineKey);
        const items = existing
          ? base.items.map((i) =>
              i.lineKey === lineKey
                ? { ...i, quantity: i.quantity + 1 }
                : i,
            )
          : [...base.items, { ...item, options, lineKey, quantity: 1 }];
        return { ...base, items };
      });
    },
    [],
  );

  const remove = useCallback((lineKey: string) => {
    setCart((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((i) => i.lineKey !== lineKey);
      return items.length ? { ...prev, items } : null;
    });
  }, []);

  const setQty = useCallback((lineKey: string, quantity: number) => {
    setCart((prev) => {
      if (!prev) return prev;
      if (quantity <= 0) {
        const items = prev.items.filter((i) => i.lineKey !== lineKey);
        return items.length ? { ...prev, items } : null;
      }
      return {
        ...prev,
        items: prev.items.map((i) =>
          i.lineKey === lineKey ? { ...i, quantity } : i,
        ),
      };
    });
  }, []);

  const clear = useCallback(() => setCart(null), []);

  const value = useMemo<CartContextValue>(() => {
    const count = cart?.items.reduce((a, i) => a + i.quantity, 0) ?? 0;
    const subtotal =
      cart?.items.reduce((a, i) => a + i.price * i.quantity, 0) ?? 0;
    return { cart, count, subtotal, add, remove, setQty, clear };
  }, [cart, add, remove, setQty, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de CartProvider");
  return ctx;
}
