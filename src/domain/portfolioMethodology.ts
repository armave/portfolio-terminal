export interface PortfolioMethodologySection {
  id: string;
  title: string;
  description: string;
  points: readonly string[];
  note?: string;
}

/**
 * User-facing explanations of calculations and limitations that are already
 * present in the current financial baseline. This is descriptive content only:
 * it must not become a second source of formulas or mutate portfolio state.
 */
export const PORTFOLIO_METHODOLOGY_SECTIONS: readonly PortfolioMethodologySection[] = [
  {
    id: 'valuation',
    title: 'Portfolio value and equity',
    description: 'The current valuation combines the signed broker account balance, separately tracked free cash, and the market value of recorded holdings.',
    points: [
      'A positive signed account balance is cash; a negative signed account balance represents margin debt.',
      'Positive account cash and positive free cash are added. Margin debt is subtracted from cash and holdings to calculate equity.',
      'A holding market value is its positive quantity multiplied by a valid positive market price. Cash holdings may use the saved price as a fallback when the current price is unavailable.'
    ],
    note: 'The valuation function returns availability and unpriced-holding counts as well as numeric values. A numeric fallback must not be presented as complete equity when required inputs are missing.'
  },
  {
    id: 'reliability',
    title: 'Current, provisional, and incomplete values',
    description: 'The reliability label describes input quality separately from the numeric estimate.',
    points: [
      'Current means the account balance is available, every positive-quantity holding has a usable price, and no required source is stale, delayed, unknown, or unavailable.',
      'Provisional means a finite estimate can be calculated, but at least one source is stale, delayed, has an unknown observation time, or is otherwise not fully current.',
      'Incomplete takes precedence when the account balance is unavailable or any positive-quantity holding cannot be priced.'
    ],
    note: 'A recently received quote is not necessarily a recently observed market price. Observation time and receipt time are different facts.'
  },
  {
    id: 'unrealized',
    title: 'Unrealized P&L versus target projections',
    description: 'Current unrealized P&L and a target-price projection answer different questions and must remain separate.',
    points: [
      'For an open margin position, gross unrealized P&L is current market value minus the cost basis of its open acquisition tranches.',
      'Gross unrealized P&L excludes commissions, financing fees or interest, taxes, and estimated future selling costs. It is not net liquidation value.',
      'A target-price projection uses the configured target price and may subtract projected sell commission and modeled margin charges. It is not current unrealized P&L.'
    ],
    note: 'When a positive-quantity holding cannot be priced, combined unrealized P&L is unavailable rather than a partial total presented as complete.'
  },
  {
    id: 'commission',
    title: 'Trading commissions',
    description: 'The configured commission model combines a per-share charge, a percentage of transaction value, and a minimum per order.',
    points: [
      'For a positive-quantity order, commission is the greater of the minimum order commission and the per-share charge plus the transaction-value charge.',
      'The percentage setting is stored as a decimal multiplier. For example, 0.0012 represents 0.12%, not 1.2%.',
      'Where commissions are calculated per tranche or order, the minimum can apply independently to each one before the amounts are added.'
    ],
    note: 'Different existing call sites have different rounding points. Do not assume every commission result is rounded at the same stage.'
  },
  {
    id: 'financing',
    title: 'Margin financing and risk estimates',
    description: 'Financing and margin-risk figures depend on the broker assumptions configured in Settings.',
    points: [
      'Margin interest uses the configured annual borrowing rate and day-count basis, eligible tranche principal, margin utilization, and daily compounding.',
      'The rollover calculation uses the configured Asia/Yerevan time; the documented default is 04:00. Runtime and legacy-import paths have distinct time-boundary and rounding behavior.',
      'Margin-call and stop-out displays are estimates derived from configured maintenance and stop-out equity thresholds. They are not live broker risk indicators or guaranteed liquidation prices.'
    ],
    note: 'Confirm borrowing rates, day-count conventions, maintenance requirements, and stop-out rules with the broker. The application settings are assumptions, not broker confirmation.'
  },
  {
    id: 'provenance',
    title: 'Broker data and market quote provenance',
    description: 'Broker-reported facts, app-maintained accounting, and market observations are related but are not interchangeable.',
    points: [
      'Broker-reported balances and aggregate positions remain separate from app-owned acquisition lots, cost basis, and funding classifications.',
      'A partial or malformed broker snapshot must not replace the last accepted account snapshot; the last-known-good data is retained and marked stale.',
      'Quote observation time is the provider timestamp when available. Receipt time records when this application received the quote and must not be used as a substitute for observation time.'
    ],
    note: 'Unknown, delayed, stale, missing, and unavailable data are distinct states. A numeric price alone does not prove that a quote is current.'
  },
  {
    id: 'limitations',
    title: 'Current methodology limitations',
    description: 'Some portfolio-wide capabilities require additional contracts and are not part of the verified current valuation baseline.',
    points: [
      'The current portfolio valuation API has no currency or FX conversion contract. Do not add values denominated in different currencies or invent an exchange rate.',
      'Historical FX requires an explicit base currency, pair direction, provider, observation timestamp, and stale-rate policy before consolidated multi-currency valuation is valid.',
      'Full portfolio time-weighted and money-weighted return methodology is being developed in Wave 2. Current gross P&L must not be described as a cash-flow-adjusted or annualized portfolio return.'
    ],
    note: 'These limitations will change only when the relevant performance and market-data contracts are implemented, reviewed, and validated.'
  }
] as const;


/** Feature-local Russian copy: kept in the lazy Settings chunk, not the startup dictionary. */
export const PORTFOLIO_METHODOLOGY_RU: Readonly<Record<string, string>> = {
  "Metric methodology and data notes": "Методика расчёта показателей и примечания к данным",
  "Review what current portfolio figures mean, which inputs they use, and where important limitations apply.": "Узнайте, что означают текущие показатели портфеля, какие данные используются и какие ограничения важно учитывать.",
  "Portfolio value and equity": "Стоимость портфеля и капитал",
  "The current valuation combines the signed broker account balance, separately tracked free cash, and the market value of recorded holdings.": "Текущая оценка объединяет знаковый денежный баланс брокерского счёта, отдельно учитываемые свободные средства и рыночную стоимость зарегистрированных активов.",
  "A positive signed account balance is cash; a negative signed account balance represents margin debt.": "Положительный знаковый баланс счёта означает денежные средства; отрицательный баланс отражает маржинальный долг.",
  "Positive account cash and positive free cash are added. Margin debt is subtracted from cash and holdings to calculate equity.": "Положительный денежный баланс счёта и положительные свободные средства складываются. Для расчёта капитала маржинальный долг вычитается из денежных средств и стоимости активов.",
  "A holding market value is its positive quantity multiplied by a valid positive market price. Cash holdings may use the saved price as a fallback when the current price is unavailable.": "Рыночная стоимость актива равна положительному количеству, умноженному на действительную положительную рыночную цену. Для денежных активов сохранённая цена может использоваться, если текущая котировка недоступна.",
  "The valuation function returns availability and unpriced-holding counts as well as numeric values. A numeric fallback must not be presented as complete equity when required inputs are missing.": "Функция оценки возвращает не только числовые значения, но и доступность баланса и количество активов без котировки. Числовую резервную величину нельзя считать полным капиталом, если обязательные данные отсутствуют.",
  "Current, provisional, and incomplete values": "Текущие, предварительные и неполные значения",
  "The reliability label describes input quality separately from the numeric estimate.": "Статус надёжности описывает качество входных данных отдельно от числовой оценки.",
  "Current means the account balance is available, every positive-quantity holding has a usable price, and no required source is stale, delayed, unknown, or unavailable.": "Статус «Текущий» означает, что баланс счёта доступен, для каждого актива с положительным количеством есть пригодная цена, а все обязательные источники актуальны и доступны.",
  "Provisional means a finite estimate can be calculated, but at least one source is stale, delayed, has an unknown observation time, or is otherwise not fully current.": "Статус «Предварительный» означает, что числовую оценку рассчитать можно, но хотя бы один источник устарел, задержан, не имеет известного времени наблюдения или не является полностью актуальным.",
  "Incomplete takes precedence when the account balance is unavailable or any positive-quantity holding cannot be priced.": "Статус «Неполный» имеет приоритет, если баланс счёта недоступен или для любого актива с положительным количеством нельзя получить цену.",
  "A recently received quote is not necessarily a recently observed market price. Observation time and receipt time are different facts.": "Недавно полученная котировка не обязательно отражает недавнее наблюдение рынка. Время наблюдения и время получения — разные данные.",
  "Unrealized P&L versus target projections": "Нереализованный результат и целевые прогнозы",
  "Current unrealized P&L and a target-price projection answer different questions and must remain separate.": "Текущий нереализованный финансовый результат и прогноз по целевой цене отвечают на разные вопросы и должны отображаться отдельно.",
  "For an open margin position, gross unrealized P&L is current market value minus the cost basis of its open acquisition tranches.": "Для открытой маржинальной позиции валовой нереализованный результат равен текущей рыночной стоимости минус себестоимость открытых лотов покупки.",
  "Gross unrealized P&L excludes commissions, financing fees or interest, taxes, and estimated future selling costs. It is not net liquidation value.": "Валовой нереализованный результат не учитывает комиссии, расходы или проценты по финансированию, налоги и предполагаемые будущие расходы на продажу. Это не чистая ликвидационная стоимость.",
  "A target-price projection uses the configured target price and may subtract projected sell commission and modeled margin charges. It is not current unrealized P&L.": "Прогноз по целевой цене использует заданную целевую цену и может учитывать предполагаемую комиссию за продажу и расчётные маржинальные расходы. Это не текущий нереализованный результат.",
  "When a positive-quantity holding cannot be priced, combined unrealized P&L is unavailable rather than a partial total presented as complete.": "Если для актива с положительным количеством нет цены, общий нереализованный результат недоступен; частичная сумма не выдаётся за полный итог.",
  "Trading commissions": "Торговые комиссии",
  "The configured commission model combines a per-share charge, a percentage of transaction value, and a minimum per order.": "Настроенная модель комиссии объединяет плату за акцию, процент от суммы сделки и минимальную комиссию за заявку.",
  "For a positive-quantity order, commission is the greater of the minimum order commission and the per-share charge plus the transaction-value charge.": "Для заявки с положительным количеством комиссия равна большему из двух значений: минимальной комиссии за заявку или суммы платы за акции и комиссии от стоимости сделки.",
  "The percentage setting is stored as a decimal multiplier. For example, 0.0012 represents 0.12%, not 1.2%.": "Процентная ставка хранится как десятичный множитель. Например, 0,0012 означает 0,12%, а не 1,2%.",
  "Where commissions are calculated per tranche or order, the minimum can apply independently to each one before the amounts are added.": "Если комиссия рассчитывается отдельно по каждому лоту или заявке, минимальная комиссия может применяться к каждому из них до суммирования.",
  "Different existing call sites have different rounding points. Do not assume every commission result is rounded at the same stage.": "В существующих местах расчёта используются разные этапы округления. Не следует считать, что каждая комиссия округляется на одном и том же этапе.",
  "Margin financing and risk estimates": "Маржинальное финансирование и оценка риска",
  "Financing and margin-risk figures depend on the broker assumptions configured in Settings.": "Показатели финансирования и маржинального риска зависят от параметров брокера, заданных в настройках.",
  "Margin interest uses the configured annual borrowing rate and day-count basis, eligible tranche principal, margin utilization, and daily compounding.": "Маржинальные проценты рассчитываются с учётом заданной годовой ставки заёмных средств и базы дней, подходящей суммы лотов, использования маржи и ежедневного начисления сложных процентов.",
  "The rollover calculation uses the configured Asia/Yerevan time; the documented default is 04:00. Runtime and legacy-import paths have distinct time-boundary and rounding behavior.": "Расчёт переноса позиции использует заданное время часового пояса Asia/Yerevan; документированное значение по умолчанию — 04:00. Рабочий путь и устаревший путь импорта имеют разные правила временных границ и округления.",
  "Margin-call and stop-out displays are estimates derived from configured maintenance and stop-out equity thresholds. They are not live broker risk indicators or guaranteed liquidation prices.": "Показатели маржин-колла и стоп-аута являются оценками на основе заданных порогов поддерживающей маржи и капитала. Это не актуальные индикаторы риска брокера и не гарантированные цены ликвидации.",
  "Confirm borrowing rates, day-count conventions, maintenance requirements, and stop-out rules with the broker. The application settings are assumptions, not broker confirmation.": "Уточняйте у брокера ставки заёмных средств, базу расчёта дней, требования по поддерживающей марже и правила стоп-аута. Настройки приложения являются предположениями, а не подтверждением брокера.",
  "Broker data and market quote provenance": "Происхождение данных брокера и рыночных котировок",
  "Broker-reported facts, app-maintained accounting, and market observations are related but are not interchangeable.": "Данные брокера, собственный бухгалтерский учёт приложения и рыночные наблюдения связаны между собой, но не являются взаимозаменяемыми.",
  "Broker-reported balances and aggregate positions remain separate from app-owned acquisition lots, cost basis, and funding classifications.": "Баланс и агрегированные позиции, сообщённые брокером, хранятся отдельно от лотов покупки, себестоимости и классификации источника финансирования, которые ведёт приложение.",
  "A partial or malformed broker snapshot must not replace the last accepted account snapshot; the last-known-good data is retained and marked stale.": "Неполный или некорректный снимок брокера не должен заменять последний принятый снимок счёта; последние достоверные данные сохраняются и помечаются как устаревшие.",
  "Quote observation time is the provider timestamp when available. Receipt time records when this application received the quote and must not be used as a substitute for observation time.": "Время наблюдения котировки — это временная метка поставщика, если она доступна. Время получения фиксирует момент поступления котировки в приложение и не заменяет время наблюдения.",
  "Unknown, delayed, stale, missing, and unavailable data are distinct states. A numeric price alone does not prove that a quote is current.": "Неизвестные, задержанные, устаревшие, отсутствующие и недоступные данные — разные состояния. Само наличие числовой цены не доказывает актуальность котировки.",
  "Current methodology limitations": "Текущие ограничения методики",
  "Some portfolio-wide capabilities require additional contracts and are not part of the verified current valuation baseline.": "Для некоторых общепортфельных возможностей нужны дополнительные контракты; они пока не входят в проверенную базовую методику оценки.",
  "The current portfolio valuation API has no currency or FX conversion contract. Do not add values denominated in different currencies or invent an exchange rate.": "В текущем API оценки портфеля нет контракта валютной конвертации или обменного курса. Не складывайте значения в разных валютах и не придумывайте курс.",
  "Historical FX requires an explicit base currency, pair direction, provider, observation timestamp, and stale-rate policy before consolidated multi-currency valuation is valid.": "Для корректной сводной оценки в нескольких валютах нужны базовая валюта, направление валютной пары, поставщик, время наблюдения и правила использования устаревшего курса.",
  "Full portfolio time-weighted and money-weighted return methodology is being developed in Wave 2. Current gross P&L must not be described as a cash-flow-adjusted or annualized portfolio return.": "Полная методика доходности портфеля, взвешенной по времени и по денежным потокам, разрабатывается в Wave 2. Текущий валовой финансовый результат нельзя описывать как доходность с учётом денежных потоков или годовую доходность.",
  "These limitations will change only when the relevant performance and market-data contracts are implemented, reviewed, and validated.": "Эти ограничения изменятся только после реализации, проверки и подтверждения соответствующих контрактов аналитики доходности и рыночных данных.",
};

export function translatePortfolioMethodology(copy: string, language: string): string {
  return language === 'ru' ? PORTFOLIO_METHODOLOGY_RU[copy] ?? copy : copy;
}
