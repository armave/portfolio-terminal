export function showToast(message, type = 'info') {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const palette = {
    success: 'border-emerald-600/70 bg-[#12241b] text-emerald-200',
    error: 'border-rose-600/70 bg-[#291418] text-rose-200',
    warning: 'border-amber-600/70 bg-[#2b2111] text-amber-200',
    info: 'border-sky-600/70 bg-[#102331] text-sky-200'
  };

  toast.className = `ui-toast border rounded-lg px-3 py-2 text-xs font-semibold ${palette[type] || palette.info}`;
  toast.classList.add('ui-toast-enter');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('ui-toast-enter');
    toast.classList.add('ui-toast-exit');
    setTimeout(() => toast.remove(), 200);
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
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }
}

if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.logTerminal = logTerminal;
}
