import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { CartProvider } from "@/hooks/useCart"
import { Toaster } from "@/components/ui/sonner"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <CartProvider>
          <App />
          <Toaster position="top-center" richColors />
        </CartProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
