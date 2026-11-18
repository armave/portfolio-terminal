import { App } from './App';
import { OfflineStatusBanner } from './components/OfflineStatusBanner';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';

interface PwaShellProps {
  onSaveGatewaySecret: (secret: string) => Promise<boolean>;
}

/** Keeps PWA controls outside account-scoped portfolio state. */
export function PwaShell({ onSaveGatewaySecret }: PwaShellProps) {
  return (
    <>
      <OfflineStatusBanner />
      <PwaInstallPrompt />
      <App onSaveGatewaySecret={onSaveGatewaySecret} />
    </>
  );
}
