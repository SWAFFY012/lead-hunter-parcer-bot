import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getSocket } from '../lib/socket';

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: 'info' | 'success' | 'error' | 'replied';
  duration?: number;
}

interface ToastCtx {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastCtx>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, toast.duration || 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Listen for WA reply events
  useEffect(() => {
    const socket = getSocket();
    socket.on('lead:replied', (data: { name?: string; phone: string; message: string }) => {
      addToast({
        type: 'replied',
        title: `💬 Ответил: ${data.name || data.phone}`,
        message: data.message.substring(0, 80) + (data.message.length > 80 ? '...' : ''),
        duration: 8000,
      });
    });
    return () => { socket.off('lead:replied'); };
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast ${toast.type}`}
            onClick={() => removeToast(toast.id)}
            style={{ cursor: 'pointer' }}
          >
            <div className="toast-title">{toast.title}</div>
            {toast.message && <div className="toast-message">{toast.message}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
