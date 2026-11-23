import { AnimatePresence, motion } from 'motion/react'
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext<(message: string) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((text: string) => {
    clearTimeout(timer.current)
    setMessage({ id: Date.now(), text })
    timer.current = setTimeout(() => setMessage(null), 2400)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        data-testid="toast"
        className="pointer-events-none fixed inset-x-0 z-[98] flex justify-center"
        style={{ bottom: 'calc(var(--player-h) + 84px)' }}
      >
        <AnimatePresence>
          {message && (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-page shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)]"
            >
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
