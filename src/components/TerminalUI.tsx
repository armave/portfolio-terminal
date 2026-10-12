import React, { useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { Header } from './Header';
import { CredentialsBar } from './CredentialsBar';
import { BrokerAssumptionsModal } from './BrokerAssumptionsModal';
import { NavigationTabs } from './NavigationTabs';
import { MarginDesk } from './MarginDesk';
import { ProjectionTable } from './ProjectionTable';
import { TradingConsole } from './TradingConsole';
import { HoldingsTable } from './HoldingsTable';
import { ClosedHistoryTable } from './ClosedHistoryTable';
import { MarketInsightsDrawer } from './MarketInsightsDrawer';

export default function TerminalUI() {
  const { state } = usePortfolio();
  const [keysHidden, setKeysHidden] = useState(true);

  const isCushion = state.activeView === 'CASH_CUSHION' || state.activeView === 'BALANCE';
  const isHistory = state.activeView === 'CLOSED_HISTORY';

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <Header keysHidden={keysHidden} onToggleKeys={() => setKeysHidden(!keysHidden)} />
      {!keysHidden && <CredentialsBar />}
      <BrokerAssumptionsModal />
      <div className="border-card p-4 sm:p-6 rounded-xl space-y-4">
        <NavigationTabs />
        {isCushion ? <HoldingsTable /> : isHistory ? <ClosedHistoryTable /> : (
          <div className="space-y-4">
            <MarginDesk />
            <MarketInsightsDrawer />
            <div className="desktop-workspace-grid grid grid-cols-1 lg:grid-cols-[3fr_7fr] gap-4 lg:gap-6 items-start">
              <ProjectionTable />
              <TradingConsole />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
