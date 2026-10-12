import React, { createContext, useContext, useState, useCallback } from 'react';

interface Toast { id: number; message: string; type: string; }
interface Log { id: number; content: string; isUser: boolean; isHtml: boolean; }

interface NotificationContextType {
  toasts: Toast[];
  logs: Log[];
  showToast: (message: string, type?: string) => void;
  logTerminal: (content: string, isUser?: boolean, isHtml?: boolean) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [logs, setLogs] = useState<Log[]>([{ id: 0, content: '[System]: Portfolio ready. Check the KV cloud status indicator for sync.', isUser: false, isHtml: false }]);

  const showToast = useCallback((message: string, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2600);
  }, []);

  const logTerminal = useCallback((content: string, isUser = false, isHtml = false) => {
    setLogs(prev => [...prev, { id: Date.now() + Math.random(), content, isUser, isHtml }]);
  }, []);

  return (
    <NotificationContext.Provider value={{ toasts, logs, showToast, logTerminal }}>
      {children}
      <div id="toastContainer" className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => {
          const palette: any = {
            success: 'border-emerald-600/70 bg-[#12241b] text-emerald-200',
            error: 'border-rose-600/70 bg-[#291418] text-rose-200',
            warning: 'border-amber-600/70 bg-[#2b2111] text-amber-200',
            info: 'border-sky-600/70 bg-[#102331] text-sky-200'
          };
          return (
            <div key={t.id} className={`ui-toast border rounded-lg px-3 py-2 text-xs font-semibold ui-toast-enter ${palette[t.type] || palette.info}`}>
              {t.message}
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
};
