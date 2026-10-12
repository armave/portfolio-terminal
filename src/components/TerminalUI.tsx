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
  const { state, refreshAllLivePrices } = usePortfolio();
  const [keysHidden, setKeysHidden] = useState(true);

  // Pull-to-refresh state
  const [pullStartY, setPullStartY] = useState<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isCushion = state.activeView === 'CASH_CUSHION' || state.activeView === 'BALANCE';
  const isHistory = state.activeView === 'CLOSED_HISTORY';

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      setPullStartY(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (pullStartY !== null && !isRefreshing) {
      const currentY = e.touches[0].clientY;
      const distance = currentY - pullStartY;
      if (distance > 0) {
        // Add visual resistance by multiplying by 0.4 and capping at 100px
        setPullDistance(Math.min(distance * 0.4, 100));
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance > 60 && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(80); // Hold indicator at threshold
      await refreshAllLivePrices();
      setIsRefreshing(false);
    }
    setPullStartY(null);
    setPullDistance(0);
  };

  return (
    <div 
      className="max-w-6xl mx-auto space-y-5 relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull to refresh indicator */}
      <div 
        className="flex justify-center items-center w-full overflow-hidden transition-all duration-200 ease-out"
        style={{ height: pullDistance > 0 ? `${pullDistance}px` : '0px', opacity: pullDistance / 80 }}
      >
        <div className="text-cyan-400 text-xs font-bold flex items-center gap-2">
          <span className={isRefreshing ? "animate-spin inline-block" : "inline-block"}>↻</span>
          {isRefreshing ? "Refreshing Quotes..." : "Pull to refresh"}
        </div>
      </div>

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
