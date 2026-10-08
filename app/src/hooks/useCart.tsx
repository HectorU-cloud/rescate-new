import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CartItem = {
  productId: number;
  name: string;
  price: number;
  emoji: string;
  quantity: number;
};

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
    item: Omit<CartItem, "quantity">,
  ) => void;
  remove: (productId: number) => void;
  setQty: (productId: number, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "al-rescate-cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as CartState) : null;
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
      item: Omit<CartItem, "quantity">,
    ) => {
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
        const existing = base.items.find((i) => i.productId === item.productId);
        const items = existing
          ? base.items.map((i) =>
              i.productId === item.productId
                ? { ...i, quantity: i.quantity + 1 }
                : i,
            )
          : [...base.items, { ...item, quantity: 1 }];
        return { ...base, items };
      });
    },
    [],
  );

  const remove = useCallback((productId: number) => {
    setCart((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((i) => i.productId !== productId);
      return items.length ? { ...prev, items } : null;
    });
  }, []);

  const setQty = useCallback((productId: number, quantity: number) => {
    setCart((prev) => {
      if (!prev) return prev;
      if (quantity <= 0) {
        const items = prev.items.filter((i) => i.productId !== productId);
        return items.length ? { ...prev, items } : null;
      }
      return {
        ...prev,
        items: prev.items.map((i) =>
          i.productId === productId ? { ...i, quantity } : i,
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
