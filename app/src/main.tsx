import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { CartProvider } from "@/hooks/useCart"
import { CityProvider } from "@/hooks/useCity"
import { DialogsProvider } from "@/providers/dialogs"
import { Toaster } from "@/components/ui/sonner"
import App from './App.tsx'
import ErrorBoundary from "@/components/ErrorBoundary"
import { initMonitoring } from "@/lib/monitoring"

initMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <CartProvider>
          <CityProvider>
            <DialogsProvider>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
              <Toaster position="top-center" richColors />
            </DialogsProvider>
          </CityProvider>
        </CartProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
