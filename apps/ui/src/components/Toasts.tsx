import { useStore, TOAST_STYLE } from '../store';
import { Icon } from '../lib/icons';

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const style = TOAST_STYLE[toast.type];
        return (
          <div
            key={toast.id}
            className={`toast-enter pointer-events-auto flex items-start gap-3 p-4 rounded-lg border shadow-xl w-80 ${style.wrap}`}
          >
            <Icon name={style.icon} className={`w-5 h-5 mt-0.5 shrink-0 ${style.iconColor}`} />
            <div className="flex flex-col gap-1">
              <span className="font-medium text-sm">{toast.title}</span>
              <span className="text-xs opacity-80">{toast.message}</span>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="ml-auto text-app-text hover:text-white shrink-0"
            >
              <Icon name="x" className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}