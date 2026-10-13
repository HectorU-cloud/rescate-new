import { Routes, Route } from "react-router";
import AppShell from "@/components/AppShell";
import Home from "./pages/Home";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import BusinessDetail from "./pages/BusinessDetail";
import Cart from "./pages/Cart";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Rescue from "./pages/Rescue";
import Onboarding from "./pages/Onboarding";
import BusinessPanel from "./pages/BusinessPanel";
import CourierPanel from "./pages/CourierPanel";
import Profile from "./pages/Profile";
import AdminCouriers from "./pages/AdminCouriers";
import AdminCourierReview from "./pages/AdminCourierReview";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="*"
        element={
          <AppShell>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/negocio/:id" element={<BusinessDetail />} />
              <Route path="/carrito" element={<Cart />} />
              <Route path="/pedidos" element={<Orders />} />
              <Route path="/pedido/:id" element={<OrderDetail />} />
              <Route path="/rescate" element={<Rescue />} />
              <Route path="/bienvenida" element={<Onboarding />} />
              <Route path="/panel" element={<BusinessPanel />} />
              <Route path="/repartidor" element={<CourierPanel />} />
              <Route path="/perfil" element={<Profile />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/repartidores" element={<AdminCouriers />} />
              <Route path="/admin/verificacion" element={<AdminCourierReview />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
