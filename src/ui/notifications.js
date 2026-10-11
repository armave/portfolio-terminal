export function showToast(message, type = 'info') {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const palette = {
    success: 'border-emerald-500/60 bg-emerald-950/80 text-emerald-200',
    error: 'border-rose-500/60 bg-rose-950/80 text-rose-200',
    warning: 'border-amber-500/60 bg-amber-950/80 text-amber-200',
    info: 'border-sky-500/60 bg-sky-950/80 text-sky-200'
  };

  toast.className = `border rounded-lg px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-sm ${palette[type] || palette.info}`;
  toast.classList.add('ui-toast-enter');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-1');
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

export function logTerminal(content, isUser = false, isHtml = false) {
  if (typeof document === 'undefined') {
    console.log(content);
    return;
  }
  const log = document.getElementById('terminalLogs') || document.getElementById('terminalLog');
  if (!log) {
    console.log(content);
    return;
  }
  const div = document.createElement('div');
  if (isUser) {
    div.className = "text-cyan-400 font-semibold";
    div.innerText = "> " + content;
  } else if (isHtml) {
    div.innerHTML = content;
  } else {
    div.className = "text-slate-300";
    div.innerText = content;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.logTerminal = logTerminal;
}
