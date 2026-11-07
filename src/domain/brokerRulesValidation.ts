export const STOP_OUT_ABOVE_MAINTENANCE_MESSAGE =
  'Stop-out equity must not exceed maintenance equity.';

export function getStopOutValidationMessage(
  stopOutValue: string,
  maintenanceValue: string
): string | null {
  if (!stopOutValue.trim() || !maintenanceValue.trim()) return null;
  const stopOut = Number(stopOutValue);
  const maintenance = Number(maintenanceValue);
  if (!Number.isFinite(stopOut) || !Number.isFinite(maintenance)) return null;
  return stopOut > maintenance ? STOP_OUT_ABOVE_MAINTENANCE_MESSAGE : null;
}
