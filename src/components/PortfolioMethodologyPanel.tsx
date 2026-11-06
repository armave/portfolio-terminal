import { getAppLanguage } from '../services/i18n';
import { PORTFOLIO_METHODOLOGY_SECTIONS, translatePortfolioMethodology } from '../domain/portfolioMethodology';

function t(copy: string): string {
  return translatePortfolioMethodology(copy, getAppLanguage());
}

/** Read-only explanations of current portfolio calculations and known limits. */
export function PortfolioMethodologyPanel() {
  return (
    <section
      class="settings-panel portfolio-methodology-panel space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
      aria-labelledby="portfolioMethodologyTitle"
      data-testid="portfolio-methodology-panel"
    >
      <div class="space-y-1">
        <h3 id="portfolioMethodologyTitle" class="text-sm font-bold text-slate-200">
          {t('Metric methodology and data notes')}
        </h3>
        <p class="text-[10px] leading-relaxed text-slate-400">
          {t('Review what current portfolio figures mean, which inputs they use, and where important limitations apply.')}
        </p>
      </div>

      <div class="space-y-2">
        {PORTFOLIO_METHODOLOGY_SECTIONS.map((section) => (
          <details
            key={section.id}
            class="rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2"
            data-methodology-section={section.id}
          >
            <summary class="min-h-8 cursor-pointer py-1 text-xs font-semibold text-slate-200 underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              {t(section.title)}
            </summary>
            <div class="space-y-2 pb-1 pt-2 text-[11px] leading-relaxed text-slate-300">
              <p>{t(section.description)}</p>
              <ul class="list-disc space-y-1 pl-4">
                {section.points.map((point) => <li key={point}>{t(point)}</li>)}
              </ul>
              {section.note && (
                <p class="rounded border border-amber-900/50 bg-amber-950/20 px-2 py-1.5 text-[10px] text-amber-100/90">
                  {t(section.note)}
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
