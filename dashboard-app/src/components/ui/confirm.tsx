import { createContext, useContext, useState, useCallback, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"

// Confirmación reusable para acciones peligrosas (reemplaza window.confirm).
// Uso: const confirm = useConfirm(); if (await confirm({ title, description, destructive })) { ... }
type ConfirmOpts = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((res) => { resolver.current = res; setOpts(o) }),
    [],
  )
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null) }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog.Root open={!!opts} onOpenChange={(o) => { if (!o) close(false) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-lg focus:outline-none">
            <Dialog.Title className="text-base font-semibold">{opts?.title}</Dialog.Title>
            {opts?.description && (
              <Dialog.Description className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{opts.description}</Dialog.Description>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => close(false)}>{opts?.cancelLabel ?? "Cancelar"}</Button>
              <Button variant={opts?.destructive ? "destructive" : "default"} size="sm" onClick={() => close(true)}>{opts?.confirmLabel ?? "Confirmar"}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmCtx.Provider>
  )
}
