import { options, type VNode } from 'preact';

export type AppLanguage = 'en' | 'ru';

const EN_DOCUMENT_TITLE = 'Margin Portfolio Terminal — Tradernet Armenia Edition';
const RU_DOCUMENT_TITLE = 'Маржинальный портфель — терминал Tradernet (Армения)';

/** Exact UI copy translations. Dynamic portfolio values and user-entered data are left untouched. */
const RU: Record<string, string> = {
  'MARGIN DESK': 'МАРЖИНАЛЬНЫЙ РАЗДЕЛ',
  'COMBINED PORTFOLIO': 'ОБЩИЙ ПОРТФЕЛЬ',
  'BALANCE': 'БАЛАНС',
  'CLOSED HISTORY': 'ИСТОРИЯ ЗАКРЫТЫХ СДЕЛОК',
  '⚙️ SETTINGS': '⚙️ НАСТРОЙКИ',
  'Settings': 'Настройки',
  'PORTFOLIO TERMINAL': 'ПОРТФЕЛЬНЫЙ ТЕРМИНАЛ',
  'Margin Portfolio Terminal — Tradernet Armenia Edition': RU_DOCUMENT_TITLE,
  'TERMINAL SETTINGS & SYNC': 'НАСТРОЙКИ ТЕРМИНАЛА И СИНХРОНИЗАЦИЯ',
  'Manage your account and quote refresh preferences.': 'Управляйте учётной записью и частотой обновления котировок.',
  'Configure broker assumptions, cloud synchronization, quote polling, and account access.': 'Настройте параметры брокера, облачную синхронизацию, обновление котировок и доступ к учётным записям.',
  'Account information unavailable': 'Информация об учётной записи недоступна',
  'Sign out': 'Выйти',
  'Pull cloud': 'Загрузить из облака',
  'Update Interval': 'Интервал обновления',
  'Off': 'Выкл.',
  '15 sec': '15 сек.',
  '30 sec': '30 сек.',
  '1 min': '1 мин.',
  'Export': 'Экспорт',
  'Import': 'Импорт',
  'Reset': 'Сбросить',
  'Language': 'Язык',
  'Account language': 'Язык интерфейса',
  'New user language': 'Язык нового пользователя',
  'English': 'Английский',
  'Russian': 'Русский',
  'User management': 'Управление пользователями',
  'Accounts share this portfolio. Guests have read-only access; admins can manage accounts.': 'Все учётные записи используют общий портфель. Гости могут только просматривать данные, администраторы управляют учётными записями.',
  'Admin controls': 'Управление администратора',
  'User name': 'Имя пользователя',
  'Password (6+ characters)': 'Пароль (не менее 6 символов)',
  'Guest': 'Гость',
  'Admin': 'Администратор',
  'Add user': 'Добавить пользователя',
  'Name': 'Имя',
  'Role': 'Роль',
  'New password': 'Новый пароль',
  'Actions': 'Действия',
  'Save': 'Сохранить',
  'Delete': 'Удалить',
  'Leave blank to keep': 'Оставьте пустым, чтобы не менять',
  'Only administrators can view or manage the user list.': 'Только администраторы могут просматривать список пользователей и управлять им.',
  'Recovery tip: export a JSON backup before resetting local data or relying on cloud sync as your only copy.': 'Совет по восстановлению: экспортируйте резервную копию JSON перед сбросом локальных данных или использованием облачной синхронизации как единственной копии.',
  'Pull the latest shared portfolio state': 'Загрузить последнюю версию общего портфеля',
  'Portfolio data refresh and backup controls': 'Обновление данных портфеля и управление резервными копиями',
  'Automatic portfolio data refresh interval': 'Интервал автоматического обновления данных портфеля',
  'Quotes update at this interval. Broker balances, positions, trades and orders sync every 60 seconds. Guests refresh only their assigned stocks and assignment changes.': 'Котировки обновляются с выбранным интервалом. Балансы, позиции, сделки и заявки брокера синхронизируются каждые 60 секунд. Для гостей обновляются только назначенные им акции и изменения назначений.',
  'Export portfolio backup as JSON': 'Экспортировать резервную копию портфеля в JSON',
  'Export portfolio state to JSON file': 'Экспортировать состояние портфеля в файл JSON',
  'Validate and confirm a portfolio backup import; cloud sync depends on KV configuration': 'Проверить и подтвердить импорт резервной копии портфеля; облачная синхронизация зависит от настроек KV',
  'Import portfolio backup from JSON': 'Импортировать резервную копию портфеля из JSON',
  'Clear all local data and return to blank slate. Export a backup first if you may need this portfolio again.': 'Удалить все локальные данные и начать с пустого портфеля. Сначала экспортируйте резервную копию, если данные могут понадобиться позже.',
  'Reset all local portfolio data': 'Сбросить все локальные данные портфеля',
  'Broker Rules': 'Параметры брокера',
  'Margin and commission rules (USD)': 'Правила маржи и комиссий (USD)',
  'Annual margin rate (%)': 'Годовая ставка маржи (%)',
  'Interest day-count': 'База расчёта дней для процентов',
  '365 days': '365 дней',
  '360 days': '360 дней',
  'Maintenance equity (%)': 'Поддерживающая маржа (%)',
  'Stop-out equity (%)': 'Уровень принудительного закрытия (%)',
  'Rollover time (ARM)': 'Время переноса позиции (ARM)',
  'Commission / share ($)': 'Комиссия за акцию ($)',
  'Commission by value (%)': 'Комиссия от суммы сделки (%)',
  'Min comm. / order ($)': 'Минимальная комиссия за заявку ($)',
  'Save rules': 'Сохранить параметры',
  'Restore defaults': 'Восстановить значения по умолчанию',
  'Saved in this browser. Confirm rates with your broker.': 'Сохранено в этом браузере. Уточняйте ставки у своего брокера.',
  'NO ACTIVE MARGIN POSITIONS': 'НЕТ АКТИВНЫХ МАРЖИНАЛЬНЫХ ПОЗИЦИЙ',
  'Start with a trade, add a cash stock, or restore a saved backup to continue.': 'Совершите сделку, добавьте акцию за собственные средства или восстановите резервную копию, чтобы продолжить.',
  'Quick Buy': 'Быстрая покупка',
  'Add Cash Stock': 'Добавить акцию за свои средства',
  'Import Backup': 'Импортировать резервную копию',
  'Trading Console': 'Торговый терминал',
  '? Help': '? Справка',
  'Clear': 'Очистить',
  '↑↓ History': '↑↓ История',
  'Run ↵': 'Выполнить ↵',
  'Read-only queries run directly. Portfolio-changing commands show a confirmation step before the saved portfolio is changed.': 'Запросы только для чтения выполняются сразу. Команды, меняющие портфель, требуют подтверждения перед сохранением изменений.',
  'Quick Commands Guide (Click any command to load)': 'Справочник команд (нажмите на команду, чтобы загрузить её)',
  'Click to fill ↗': 'Нажмите, чтобы вставить ↗',
  'Portfolio Actions': 'Действия с портфелем',
  'Close · Esc': 'Закрыть · Esc',
  'Compare': 'Сравнить',
  'BEST': 'ЛУЧШИЙ',
  'No active position to project.': 'Нет активных позиций для построения прогноза.',
  'Entry': 'Вход',
  'Position opened · projection values start today': 'Позиция открыта · значения прогноза рассчитаны с сегодняшнего дня',
  'Previous': 'Назад',
  'Next': 'Далее',
  'Checking account setup…': 'Проверка настроек учётной записи…',
  'Password': 'Пароль',
  'Use at least 6 characters.': 'Используйте не менее 6 символов.',
  'Gateway Secret': 'Секретный ключ шлюза',
  'Loading your portfolio and assigned stocks. Please wait…': 'Загрузка вашего портфеля и назначенных акций. Пожалуйста, подождите…',
  'Retry': 'Повторить',
  'Continue offline': 'Продолжить без подключения',
  'Projected portfolio net value, fees and commissions, margin fee, and balance by date.': 'Прогноз чистой стоимости портфеля, комиссий, маржинальных процентов и баланса по датам.',
  'Date': 'Дата',
  'Net': 'Итого',
  'F&C': 'Комиссии',
  'M Fee': 'Маржинальные проценты',
  'Balance': 'Баланс',
  'PT': 'PT',
  'Shares': 'Акций',
  'Total shares': 'Всего акций',
  'Select a margin position to load its market insights.': 'Выберите маржинальную позицию, чтобы загрузить аналитику рынка.',
  'Loading live data...': 'Загрузка актуальных данных…',
  'Loading company news…': 'Загрузка новостей компании…',
  'No recent news found.': 'Свежих новостей не найдено.',
  'Refresh failed; showing previously loaded news.': 'Не удалось обновить данные; показаны ранее загруженные новости.',
  'Trailing P/E': 'P/E за прошедший период',
  'Forward P/E': 'Прогнозный P/E',
  'PEG Ratio': 'Коэффициент PEG',
  'Short % Float': 'Доля коротких позиций',
  'Profit Margin': 'Рентабельность продаж',
  'ROE': 'Рентабельность капитала',
  'Price to Book': 'Цена / балансовая стоимость',
  'Total Debt': 'Общий долг',
  'Mean': 'Среднее',
  'High': 'Максимум',
  'Low': 'Минимум',
  'Consensus': 'Консенсус',
  'Recent Firm Actions': 'Последние действия аналитиков',
  'No recent actions': 'Недавних действий нет',
  'Next Earnings Date': 'Дата следующего отчёта',
  'Past Earnings Surprises': 'Отклонения прошлых отчётов',
  'No recent earnings history': 'Нет недавней истории отчётности',
  'Loading': 'Загрузка',
  'Open Stocktwits ↗': 'Открыть Stocktwits ↗',
  'Select a ticker to view community posts.': 'Выберите тикер, чтобы просмотреть сообщения сообщества.',
  'Loading Stocktwits stream…': 'Загрузка ленты Stocktwits…',
  'Load Stocktwits messages to view community posts.': 'Загрузите сообщения Stocktwits, чтобы просмотреть публикации сообщества.',
  'No recent Stocktwits messages found.': 'Свежих сообщений Stocktwits не найдено.',
  'Refresh failed; showing previously loaded messages.': 'Не удалось обновить данные; показаны ранее загруженные сообщения.',
  'No single-ticker messages found.': 'Сообщений по этому тикеру не найдено.',
  'Read full article ↗': 'Читать статью полностью ↗',
  'Company news articles': 'Новости компаний',
  'Refresh company news': 'Обновить новости компании',
  'Market insight categories': 'Категории рыночной аналитики',
  'Refresh Stocktwits messages': 'Обновить сообщения Stocktwits',
  'Stocktwits messages': 'Сообщения Stocktwits',
  'Close news article': 'Закрыть новость',
  'Gemini · Margin Intelligence': 'Gemini · Аналитика маржи',
  'Read-only · No broker orders are changed': 'Только просмотр · заявки брокеру не изменяются',
  'Close': 'Закрыть',
  'Market depth': 'Стакан заявок',
  'Depth': 'Стакан',
  'Bid': 'Покупка',
  'Ask': 'Продажа',
  'Price': 'Цена',
  'Quantity': 'Количество',
  'Spread': 'Спред',
  'Loading market depth…': 'Загрузка стакана заявок…',
  'Refresh depth': 'Обновить стакан',
  'No bid levels returned.': 'Нет уровней спроса.',
  'No ask levels returned.': 'Нет уровней предложения.',
  'TradeNet authenticated a demo or unverified session. Demo order-book data is intentionally not shown.': 'TradeNet авторизовал демо- или неподтверждённую сессию. Демо-данные стакана намеренно не отображаются.',
  'Freedom API keys are not configured in this Worker.': 'API-ключи Freedom не настроены в Cloudflare Worker.',
  'Freedom active orders are unavailable — existing position targets are unchanged.': 'Активные заявки Freedom недоступны — целевые цены позиций оставлены без изменений.',
  '[Freedom Warning] Active-order refresh failed; existing position targets were left unchanged.': '[Предупреждение Freedom] Не удалось обновить активные заявки; целевые цены позиций оставлены без изменений.',
  'TradeNet market-depth feed is unavailable.': 'Поток данных стакана TradeNet недоступен.',
  'Syncing fresh news and regenerating the review…': 'Загрузка свежих новостей и обновление анализа…',
  'No news articles were returned by the connected provider. Treat any news-dependent conclusions as limited.': 'Подключённый провайдер не вернул новости. Выводы, зависящие от новостей, следует считать ограниченными.',
  'What-if analysis': 'Анализ сценария',
  'Estimates only · actual results may differ.': 'Только оценки · фактические результаты могут отличаться.',
  'Done': 'Готово',
  'SYSTEM': 'СИСТЕМА',
  'WHAT-IF REPORT': 'ОТЧЁТ ПО СЦЕНАРИЮ',
  'View report': 'Посмотреть отчёт',
  'Current market value': 'Текущая рыночная стоимость',
  'Assigned shares': 'Назначенные акции',
  'Price · share': 'Цена · акция',
  'Avg. entry': 'Средняя цена входа',
  'Unrealized P/L': 'Нереализованная прибыль/убыток',
  'No active tranche details available.': 'Данные об активных лотах отсутствуют.',
  'Entry price': 'Цена входа',
  'Ticker': 'Тикер',
  'Q': 'Кол-во',
  'Mkt': 'Рынок',
  'Avg B.': 'Ср. покупка',
  'Avg Val.': 'Ср. стоимость',
  'Mkt Val.': 'Рыночная стоимость',
  'P/L': 'Прибыль/убыток',
  'Eq. Alloc': 'Доля капитала',
  'Open purchases from Freedom trade history · new operations default to Cash': 'Открытые покупки из истории сделок Freedom · новые операции по умолчанию относятся к денежным средствам',
  'Purchase date': 'Дата покупки',
  'Avg. Cost': 'Средняя стоимость',
  'Value': 'Стоимость',
  'Operation': 'Операция',
  'Guest · cash shares': 'Гость · акции за собственные средства',
  'Assigned guest · shares': 'Назначенный гость · количество акций',
  'Cash': 'Денежные средства',
  'Margin': 'Маржа',
  'Mix': 'Смешанное',
  'Unassigned': 'Не назначено',
  'Unclassified': 'Не классифицировано',
  'Funding · guest · cash shares': 'Финансирование · гость · денежные акции',
  'Cash shares': 'Акции за денежные средства',
  'Margin shares': 'Маржинальные акции',
  'Guest unavailable': 'Гость недоступен',
  'No guest accounts': 'Нет гостевых учётных записей',
  'Refreshing guest accounts…': 'Обновление списка гостевых учётных записей…',
  'Guest account refresh failed. Existing assignments are still shown.': 'Не удалось обновить список гостевых учётных записей. Текущие назначения сохранены.',
  'Could not load guest accounts. Retry to restore guest assignments.': 'Не удалось загрузить гостевые учётные записи. Повторите попытку, чтобы восстановить назначения.',
  'Retry guest account list': 'Повторить загрузку списка гостевых учётных записей',
  'No cash allocation': 'Нет распределения денежных средств',
  'Your active stock cards': 'Карточки ваших активных акций',
  'Market value minus average purchase value': 'Рыночная стоимость за вычетом средней цены покупки',
  'Trades': 'Сделки',
  'TRADES': 'СДЕЛКИ',
  'Closed trades and sell executions, including partial sales. Buy executions are used for duration matching, not shown as closed trades.': 'Закрытые сделки и исполнения продаж, включая частичные продажи. Исполнения покупок используются для расчёта срока удержания и не показываются как закрытые сделки.',
  'Realized net P&L': 'Фактическая чистая прибыль/убыток',
  'Win rate': 'Доля прибыльных сделок',
  'Fees & commissions': 'Сборы и комиссии',
  'Avg. holding time': 'Средний срок удержания',
  'Date Closed': 'Дата закрытия',
  'Duration': 'Длительность',
  'Fees': 'Сборы',
  'Commissions': 'Комиссии',
  'Net Profit': 'Чистая прибыль',
  'Loading closed trade history…': 'Загрузка истории закрытых сделок…',
  'Unable to load TradeNet history. Please retry.': 'Не удалось загрузить историю TradeNet. Повторите попытку.',
  'TradeNet refresh failed. Showing saved history, which may be out of date.': 'Не удалось обновить историю TradeNet. Показана сохранённая история, которая может быть устаревшей.',
  'Retry TradeNet history': 'Повторить загрузку истории TradeNet',
  'Refreshing TradeNet history…': 'Обновление истории TradeNet…',
  'Retrying…': 'Повторная попытка…',
  'Closed trade history with ticker, closing date, quantity, duration, fees, commissions, and net profit.': 'История закрытых сделок с тикером, датой закрытия, количеством акций, сроком удержания, сборами, комиссиями и чистой прибылью.',
  'No closed trades recorded yet.': 'Закрытых сделок пока нет.',
  'Closed trade history': 'История закрытых сделок',
  'Closed trade performance summary': 'Сводка результатов закрытых сделок',
  'Closed history pagination': 'Страницы истории закрытых сделок',
  'Previous closed history page': 'Предыдущая страница истории закрытых сделок',
  'Next closed history page': 'Следующая страница истории закрытых сделок',
  'ACCOUNT EQUITY HEALTH': 'СОСТОЯНИЕ КАПИТАЛА СЧЁТА',
  '40% reference': 'Ориентир 40%',
  '100% assets': 'Активы 100%',
  'MARGIN-CALL BUFFER': 'ЗАПАС ДО МАРЖИН-КОЛЛА',
  'Trigger estimate': 'Оценка порога',
  'STOP-OUT THRESHOLD': 'ПОРОГ ПРИНУДИТЕЛЬНОГО ЗАКРЫТИЯ',
  'Equity and collateral details': 'Сведения о капитале и обеспечении',
  'Account equity': 'Собственный капитал счёта',
  'Cash / collateral': 'Денежные средства / обеспечение',
  'Estimates use configured broker thresholds and are not live broker risk indicators.': 'Оценки используют заданные пороги брокера и не являются актуальными индикаторами риска брокерского счёта.',
  'POSITION BASIS': 'ОСНОВА ПОЗИЦИЙ',
  'Tranches / Holdings': 'Лоты / активы',
  'Total Invested': 'Всего инвестировано',
  'MARKET VALUATION': 'РЫНОЧНАЯ ОЦЕНКА',
  'Market Value / Return': 'Рыночная стоимость / доходность',
  'DEBT & CARRYING COSTS': 'ДОЛГ И РАСХОДЫ НА ФИНАНСИРОВАНИЕ',
  'Margin Debt': 'Маржинальный долг',
  'Total Commissions': 'Общая сумма комиссий',
  'Accrued Margin Interest': 'Начисленные проценты по марже',
  'Shares / Tranches': 'Акции / лоты',
  'Invested / Avg. Entry': 'Инвестировано / средний вход',
  'Share Price / Market Value': 'Цена акции / рыночная стоимость',
  'Update quotes': 'Обновить котировки',
  'Refresh live quotes': 'Обновить актуальные котировки',
  'Portfolio Assets': 'Активы портфеля',
  'Show CLI command reference in terminal': 'Показать справочник команд терминала',
  'Clear terminal log output': 'Очистить журнал терминала',
  'Terminal command': 'Команда терминала',
  'Run the command. Portfolio-changing actions require confirmation before they are applied.': 'Выполнить команду. Действия, изменяющие портфель, требуют подтверждения.',
  'Quick actions for the selected stock': 'Быстрые действия для выбранной акции',
  'Close scenario comparison': 'Закрыть сравнение сценариев',
  'Projection table pagination': 'Страницы таблицы прогнозов',
  'Previous projection page': 'Предыдущая страница прогноза',
  'Next projection page': 'Следующая страница прогноза',
  'Portfolio workspace': 'Рабочая область портфеля',
  'Portfolio assets': 'Активы портфеля',
  'Portfolio summary metrics': 'Сводные показатели портфеля',
  'Portfolio projection by date': 'Прогноз портфеля по датам',
  'Market insights': 'Рыночная аналитика',
  'Close scenario report': 'Закрыть отчёт по сценарию',
  'Scenario report details': 'Подробности отчёта по сценарию',
  'New user role': 'Роль нового пользователя',
  'Name for ': 'Имя: ',
  'Role for ': 'Роль: ',
  'Language for ': 'Язык: ',
  'New password for ': 'Новый пароль: ',
  'Delete account': 'Удалить учётную запись',
  'admin': 'администратор',
  'guest': 'гость',
  'No active cash-funded stocks are linked to your account yet.': 'К вашей учётной записи пока не привязаны акции, приобретённые за собственные средства.',
  'Stocktwits': 'Stocktwits',
  'Margin risk and account equity': 'Маржинальный риск и капитал счёта',
  'Account equity percentage': 'Доля собственного капитала счёта',
  'Margin-call buffer': 'Запас до маржин-колла',
  'Portfolio financial summary': 'Финансовая сводка портфеля',
  "MY STOCKS": "МОИ АКЦИИ",
  "CASH & NON-MARGIN HOLDINGS": "ДЕНЕЖНЫЕ СРЕДСТВА И АКЦИИ БЕЗ МАРЖИ",
  "Only cash-funded shares assigned to you by an administrator appear here.": "Здесь отображаются ваши акции.",
  "No stocks are assigned to your account yet.": "В вашей учётной записи пока нет назначенных акций.",
  "Ask your administrator to assign the cash-funded portion of an active stock purchase. Your assigned stocks will appear here automatically.": "Попросите администратора назначить вам денежную часть активной покупки акций. Назначенные акции автоматически появятся здесь.",
  "Market quote unavailable. Market value and unrealized P/L will appear when a valid quote is received.": "Рыночная котировка недоступна. Рыночная стоимость и нереализованная прибыль/убыток появятся после получения корректной котировки.",
  "Partial value: holdings without a valid market quote are excluded.": "Частичная стоимость: активы без корректной рыночной котировки не учитываются.",
  "Current market value of your assigned cash-funded stocks.": "Текущая рыночная стоимость назначенных вам акций, приобретённых за денежные средства.",
  "Quote unavailable": "Котировка недоступна",
  "tranche": "лот",
  "tranches": "лотов",
  "Date unavailable": "Дата недоступна",
  "Unassigned · shared holdings": "Не назначено · общие активы",
  "Verifying account access…": "Проверка доступа к учётной записи…",
  "No active cash-funded stocks are linked to your account.": "К вашей учётной записи не привязаны активные акции, приобретённые за денежные средства.",
  "No broker-reported cash holdings available.": "Данные о денежных активах от брокера отсутствуют.",
  "The selected data source did not provide a sentiment signal.": "Выбранный источник данных не предоставил сигнал настроения рынка.",
  "A directional marker based only on the provider values shown in this section.": "Направленный индикатор основан только на значениях провайдера, показанных в этом разделе.",
  "Broker data stale": "Данные брокера устарели",
  "Trades synced": "Сделки синхронизированы",
  "Waiting for trade history": "Ожидание истории сделок",
  "Collapse": "Свернуть",
  "Expand": "Развернуть",
  "No active purchase operations.": "Нет активных операций покупки.",
  "Active purchase operations will appear after Freedom trade history loads.": "Активные операции покупки появятся после загрузки истории сделок Freedom.",
  "Hide cash and margin quantities": "Скрыть количество денежных и маржинальных акций",
  "Edit cash and margin quantities": "Изменить количество денежных и маржинальных акций",
  "operation type": "тип операции",
  "Guest assignment": "Назначение гостю",
  "cash shares": "акции за денежные средства",
  "margin shares": "маржинальные акции",
  "Not fetched": "Не получено",
  "Source unavailable": "Источник недоступен",
  "Stale": "Устарело",
  "Delayed": "С задержкой",
  "Time unknown": "Время неизвестно",
  "Publication time unavailable": "Время публикации недоступно",
  "Not synced yet": "Ещё не синхронизировано",
  "Sync time unavailable": "Время синхронизации недоступно",
  "Synced just now": "Только что синхронизировано",
  "Synced": "Синхронизировано",
  "No server-synced digest yet": "Синхронизированный с сервером анализ пока отсутствует",
  "Sources reviewed": "Изученные источники",
  "News source": "Источник новости",
  "AI-generated analysis can be wrong or incomplete. Verify material facts from original sources. This is not personalized financial advice; use your own judgment before changing a position.": "Анализ, созданный ИИ, может содержать ошибки или быть неполным. Проверяйте важные факты по первоисточникам. Это не персональная финансовая рекомендация; принимайте решения об изменении позиции самостоятельно.",
  "Create administrator account": "Создать учётную запись администратора",
  "Portfolio Terminal sign in": "Вход в Portfolio Terminal",
  "Initial setup is one-time. Use the Worker Gateway Secret to create the first admin account.": "Первоначальная настройка выполняется один раз. Используйте секретный ключ Worker Gateway для создания первой учётной записи администратора.",
  "Sign in with the account created by an administrator.": "Войдите с учётной записью, созданной администратором.",
  "Could not connect to the authentication service.": "Не удалось подключиться к службе аутентификации.",
  "The account was created, but this device could not establish its session.": "Учётная запись создана, но на этом устройстве не удалось открыть сессию.",
  "Loading portfolio…": "Загрузка портфеля…",
  "Create admin account": "Создать учётную запись администратора",
  "Sign in": "Войти",
  "Unknown error": "Неизвестная ошибка",
  "Unable to load company news.": "Не удалось загрузить новости компании.",
  "Unable to load Stocktwits.": "Не удалось загрузить Stocktwits.",
  "Untitled article": "Статья без названия",
  "Company news": "Новости компании",
  "A summary is not available from the news provider. Open the original article for the full story.": "Провайдер новостей не предоставил краткое содержание. Откройте оригинальную статью, чтобы прочитать её полностью.",
  "Read news": "Читать новость",
  "News": "Новости",
  "Fundamentals": "Фундаментальные показатели",
  "Earnings": "Отчётность",
  "Analysts": "Аналитики",
  "Refresh": "Обновить",
  "Load": "Загрузить",
  "Refreshing…": "Обновление…",
  "Net P&L": "Чистая прибыль/убыток",
  "Projection Date": "Дата прогноза",
  "Metric": "Показатель",
  "Stop-out level": "Уровень принудительного закрытия",
  "Margin-call level": "Уровень маржин-колла",
  "negative equity": "отрицательный собственный капитал",
  "Below trigger estimate": "Ниже расчётного порога",
  "Healthy": "Норма",
  "No margin debt": "Нет маржинального долга",
  "Elevated": "Повышенный риск",
  "None": "Нет",
  "No live quotes fetched for margin positions": "Для маржинальных позиций ещё не получены актуальные котировки",
  "Latest portfolio quote": "Последняя котировка портфеля",
  "maintenance": "поддерживающая маржа",
  "equity": "собственный капитал",
  "Account equity health": "Состояние собственного капитала счёта",
  "records": "записей",
  "Unknown": "Неизвестно",
  "days": "дн.",
  "hrs": "ч",
  "Buy More Scenario (What-if)": "Сценарий дополнительной покупки (что если)",
  "Exit Comparison": "Сравнение вариантов выхода",
  "Live / Manual Quote": "Актуальная / ручная котировка",
  "Refresh Quotes": "Обновить котировки",
  "↻ Refresh Quotes": "↻ Обновить котировки",
  "✦ Portfolio Review": "✦ Анализ портфеля",
  "Fetch live quotes for all tracked holdings immediately": "Немедленно получить актуальные котировки для всех отслеживаемых активов",
  "Use Gemini to review recent news and risk across all margin positions": "Использовать Gemini для анализа последних новостей и рисков по всем маржинальным позициям",
  "Print all local CLI commands": "Показать все локальные команды терминала",
  "⚡ Quote": "⚡ Котировка",
  "✦ News + Review": "✦ Новости и анализ",
  "⇄ Compare Exits…": "⇄ Сравнить выходы…",
  "⇧ Buy More Scenario…": "⇧ Сценарий дополнительной покупки…",
  "Immediately pull latest quote for": "Немедленно получить последнюю котировку для",
  "Review recent news and margin-position risks for": "Проанализировать последние новости и риски маржинальной позиции",
  "Compare exit scenarios without placing a trade": "Сравнить сценарии выхода без размещения заявки",
  "Could not update user.": "Не удалось обновить пользователя.",
  "Could not update language.": "Не удалось обновить язык.",
  "Stop-out equity must not exceed maintenance equity.": "Уровень принудительного закрытия не должен превышать уровень поддерживающей маржи.",
  "Could not finish initializing the app.": "Не удалось завершить инициализацию приложения.",
  "Initializing your portfolio…": "Инициализация портфеля…",
  "Check your connection, then retry or continue offline.": "Проверьте подключение, затем повторите попытку или продолжите без подключения.",
  "Restoring saved data and market connections": "Восстановление сохранённых данных и подключений к рынку",
  "Freedom account data unavailable — saved portfolio data is being retained.": "Данные счёта Freedom недоступны — сохранённые данные портфеля остаются без изменений.",
  "Only an active purchase tranche can be linked to a guest.": "Гостю можно назначить только активный лот покупки.",
  "Only a tranche with a positive cash allocation can be linked to a guest.": "Гостю можно назначить только лот с положительным количеством акций за денежные средства.",
  "Could not verify guest account.": "Не удалось проверить гостевую учётную запись.",
  "Select an existing guest account.": "Выберите существующую гостевую учётную запись.",
  "Please sign in with your account.": "Войдите в свою учётную запись.",
  "Secure session storage failed. Sign in again after refresh.": "Не удалось безопасно сохранить сессию. После обновления страницы войдите снова.",
  "Could not sign out cleanly.": "Не удалось корректно завершить сеанс.",
  "Gateway Secret is not available.": "Секретный ключ Gateway недоступен.",
  "Unable to sync closed history:": "Не удалось синхронизировать историю закрытых сделок:",
  "Unable to load closed history from cloud:": "Не удалось загрузить историю закрытых сделок из облака:",
  "Cloud history did not confirm the update.": "Облако не подтвердило обновление истории.",
  "Failed to sync closed-history cashflows and fees:": "Не удалось синхронизировать денежные потоки и комиссии истории закрытых сделок:",
  "unknown sync error": "неизвестная ошибка синхронизации",
  "Unable to recalculate saved closed-history cashflows:": "Не удалось пересчитать сохранённые денежные потоки истории закрытых сделок:",
  "Unable to sync updated broker history:": "Не удалось синхронизировать обновлённую историю брокера:",
  "Updated": "Обновлено",
  "Quote status": "Статус котировки",
  "Assigned stock value": "Стоимость назначенных акций",
  "Partial value": "Частичная стоимость",
  "Market quote": "Рыночная котировка",
  "A valid market quote is required to calculate market value and unrealized P/L.": "Для расчёта рыночной стоимости и нереализованной прибыли/убытка необходима корректная рыночная котировка.",
  "Stocktwits unavailable": "Stocktwits недоступен",
  "Show less": "Показать меньше",
  "New": "Новая",
  "Day:": "За день:",
  "Sync failed": "Ошибка синхронизации",
  "TODAY": "СЕГОДНЯ",
  "BREAKEVEN": "БЕЗУБЫТОЧНОСТЬ",
  "Portfolio CLI ready. Broker-synced portfolio data is available; refresh quotes or choose a quick action below.": "Терминал портфеля готов. Доступны синхронизированные с брокером данные; обновите котировки или выберите быстрое действие ниже.",
  "Position value": "Стоимость позиции",
  "Combined Breakeven": "Безубыточность портфеля",
  "Buy More Projection": "Прогноз дополнительной покупки",
  "MARGIN": "МАРЖА",
  "Rows": "Строки",
  "Page": "Страница",
  "No quote for": "Нет котировки для",
  "[Freedom] Active tickers, cash/margin classifications, balance and prices refreshed.": "Обновлены активные тикеры, классификация денежных и маржинальных позиций, баланс и цены.",
  "[Freedom Warning] Account refresh failed; retained local data and marked the last broker snapshot stale.": "Не удалось обновить данные счёта Freedom; локальные данные сохранены, а последний снимок брокера помечен как устаревший.",
  "[Guest Portfolio Sync Error]: Assigned holdings could not be refreshed.": "Не удалось обновить назначенные гостю активы.",
  "Reset the terminal to a blank slate? This clears saved portfolio and history data locally and in KV cloud. It does not delete TradeNet records held by the broker; those read-only records may reappear when broker history is refreshed.": "Сбросить терминал до пустого состояния? Сохранённые данные портфеля и история будут удалены локально и из облака KV. Записи TradeNet у брокера не удаляются; эта история доступна только для чтения и может появиться снова после обновления данных брокера.",
  "[System]: Portfolio reset to a clean blank slate.": "Портфель сброшен до пустого состояния.",
  "[System]: Closed trade history cleared from KV cloud.": "История закрытых сделок очищена в облаке KV.",
  "The portfolio was reset in memory, but some local data could not be cleared. Check browser storage before reloading.": "Портфель сброшен в памяти, но не удалось очистить часть локальных данных. Проверьте хранилище браузера перед перезагрузкой.",
  "The portfolio was reset locally, but cloud closed history could not be cleared. Restore cloud access and retry the reset.": "Портфель сброшен локально, но не удалось очистить историю сделок в облаке. Восстановите доступ к облаку и повторите сброс.",
  "[Market Data Warning]: No quotes updated during batch fetch.": "При пакетном запросе не удалось обновить ни одной котировки.",
  "[Backup Import]: Import cancelled; the current portfolio was not changed.": "Импорт отменён; текущий портфель не изменён.",
  "Invalid buy details.": "Некорректные данные покупки.",
  "Sale price must be greater than zero.": "Цена продажи должна быть больше нуля.",
  "Cash holding sale failed.": "Не удалось продать акцию за денежные средства.",
  "Margin position sale failed.": "Не удалось продать маржинальную позицию.",
  "[Margin Sync Error]: Enter a valid finite debt amount.": "Введите корректную конечную сумму маржинального долга.",
  "Invalid margin debt amount.": "Некорректная сумма маржинального долга.",
  "[AI Action]: Cancelled.": "Действие ИИ отменено.",
  "Executed.": "Выполнено.",
  "READY": "ГОТОВО",
  "FAIL": "ОШИБКА",
  "Please enter a valid Gateway Secret": "Введите корректный секретный ключ Gateway.",
  "Gateway Secret saved. Remote access has not been verified yet.": "Секретный ключ Gateway сохранён. Удалённый доступ ещё не проверен.",
  "Gateway Secret is available for this session, but secure device storage failed. It may need to be entered again after refresh.": "Секретный ключ Gateway доступен в этой сессии, но не удалось безопасно сохранить его на устройстве. После обновления страницы его может потребоваться ввести снова.",
  "Gateway Secret required to access cloud state.": "Для доступа к облачному состоянию требуется секретный ключ Gateway.",
  "Gateway Secret saved.": "Секретный ключ Gateway сохранён.",
  "Remote access has not been verified yet.": "Удалённый доступ ещё не проверен.",
  "Could not persist the imported backup to browser storage.": "Не удалось сохранить импортированную резервную копию в памяти браузера.",
  "[AI Action Error]": "Ошибка действия ИИ",
  "[KV Cloud Error]": "Ошибка облака KV",
  "Cloud pull failed": "Не удалось загрузить данные из облака",
  "[Market Data Error]": "Ошибка рыночных данных",
  "[Sell Error]": "Ошибка продажи",
  "[Freedom] Active sell target sync": "Синхронизация целевых цен активных продаж",
  "LOTS": "ЛОТЫ",
  "Source": "Источник",
  "Trade": "Сделка",
  "Tranche": "Лот",
  "Guest assignment history table": "Таблица истории назначений гостю",
  "Cash-funded stock holdings": "Акции, приобретённые за денежные средства",
  "Active tranches and guest assignments": "Активные лоты и назначения гостям",
  "User management table": "Таблица управления пользователями",
  "Your cash-funded purchase allocations, including completed and removed assignments": "Ваши покупки за собственные средства, включая завершённые и снятые с назначения лоты",
  "Active": "Активные",
  "Closed": "Закрытые",
  "Open cost basis": "Себестоимость открытых лотов",
  "Open market value": "Рыночная стоимость открытых лотов",
  "All tickers": "Все тикеры",
  "Status": "Статус",
  "All statuses": "Все статусы",
  "Assigned from": "Назначено с",
  "Assigned to": "Назначено по",
  "Assignment history will appear here after the administrator's next successful portfolio sync. Only assignments created before this history feature and still open can be backfilled.": "История назначений появится здесь после следующей успешной синхронизации портфеля администратором. Можно восстановить только назначения, созданные до появления этой функции и остающиеся открытыми.",
  "No assignments match these filters.": "Нет назначений, соответствующих выбранным фильтрам.",
  "Assigned": "Назначено",
  "Date from": "Дата с",
  "Date to": "Дата по",
  "Open shares": "Остаток акций",
  "Avg. cost": "Средняя цена",
  "Value": "Стоимость",
  "Assigned cost basis across filtered records:": "Себестоимость назначенных лотов по выбранным записям:",
  "· Some open holdings have no current quote": "· Для некоторых открытых активов нет актуальной котировки",
  "Value shows current market value for open tranches and gross sale proceeds for closed trades. Net P&L appears only when the closed trade's net result is available.": "В столбце «Стоимость» показана текущая рыночная стоимость открытых лотов и валовая выручка от продажи закрытых сделок. Чистая прибыль/убыток отображается только при наличии итоговых данных закрытой сделки.",
  "Preparing lots": "Подготовка раздела лотов",
  "Loading your assigned tranche history…": "Загрузка истории назначенных вам лотов…",
  "Workspace navigation": "Навигация по разделам",
  "Preparing margin desk": "Подготовка маржинального раздела",
  "Refreshing live quotes and preparing the latest portfolio view…": "Обновление актуальных котировок и подготовка последнего состояния портфеля…",
  "Preparing balance": "Подготовка баланса",
  "Loading holdings and account allocations…": "Загрузка активов и распределения по счетам…",
  "Preparing trades": "Подготовка сделок",
  "Restoring saved trades and broker activity…": "Восстановление сохранённых сделок и активности брокера…",
  "Preparing settings": "Подготовка настроек",
  "Loading account access and preferences…": "Загрузка доступа к учётной записи и настроек…",
  "Market price": "Рыночная цена",
  "Average entry": "Средняя цена входа",
  "Average value": "Средняя стоимость",
  "Market value": "Рыночная стоимость",
  "Allocation": "Распределение",
  "Summary": "Сводка",
  "Average cost": "Средняя стоимость",
  "↻ Refresh": "↻ Обновить",
  "Read-only order book snapshot · TradeNet": "Снимок стакана заявок TradeNet · только для чтения",
  "Best bid": "Лучшая цена покупки",
  "Best ask": "Лучшая цена продажи",
  "Bids · buyers": "Заявки на покупку · покупатели",
  "Asks · sellers": "Заявки на продажу · продавцы",
  "TradeNet returned an unrecognized market-depth response.": "TradeNet вернул ответ стакана заявок в неизвестном формате.",
  "Open market depth": "Открыть стакан заявок",
  "Close market depth": "Закрыть стакан заявок",
  "API keys": "Ключи API",
  "· Refreshing…": "· Обновление…",
  "Refresh news": "Обновить новости",
  "Could not load users.": "Не удалось загрузить список пользователей.",
  "Could not create user.": "Не удалось создать пользователя.",
  "Could not delete user.": "Не удалось удалить пользователя.",
  "Authentication failed.": "Не удалось пройти аутентификацию.",
  "Could not load guest accounts.": "Не удалось загрузить список гостевых учётных записей.",
  "Loading holdings, trade activity and account allocations…": "Загрузка активов, истории сделок и распределения по счетам…",
  "Unknown cashflow processing error.": "Неизвестная ошибка обработки денежных потоков.",
  "Unable to process saved closed-history cashflows": "Не удалось обработать сохранённые денежные потоки истории закрытых сделок",
  "Unknown broker API error.": "Неизвестная ошибка API брокера.",
  "Automatic Freedom cashflow sync failed": "Не удалось автоматически синхронизировать денежные потоки Freedom",
  "Freedom cashflow processing failed": "Не удалось обработать денежные потоки Freedom",
  "Restoring saved trade history and loading the latest Freedom activity…": "Восстановление сохранённой истории сделок и загрузка последних операций Freedom…",
  "Known net P&L": "Чистая прибыль/убыток по известным сделкам",
  "Open market depth for": "Открыть стакан заявок для",
  "Scenario report": "Отчёт по сценарию",
  "Current position vs. proposed purchase · profit, downside, exposure and fees": "Текущая позиция и предлагаемая покупка · прибыль, риск снижения, экспозиция и комиссии",
  "Sell now vs. future exits · estimated net results after costs": "Продажа сейчас или позже · расчётная чистая прибыль после расходов",
  "Before vs. after · estimated values": "До и после · расчётные значения",
  "Portfolio-wide Margin Review": "Обзор маржинального портфеля",
  "Untitled news item": "Новость без заголовка",
  "Gemini returned an empty analysis.": "Gemini вернул пустой анализ.",
  "Could not load or save the synced Gemini margin review.": "Не удалось загрузить или сохранить синхронизированный анализ маржинального портфеля Gemini.",
  "TradeNet live-data session initialization failed": "Не удалось инициализировать сессию получения данных TradeNet в реальном времени",
  "Unable to load TradeNet executed trades": "Не удалось загрузить исполненные сделки TradeNet",
  "Unable to load active TradeNet orders": "Не удалось загрузить активные заявки TradeNet",
  "Something went wrong.": "Что-то пошло не так.",
  "ERROR": "ОШИБКА",
  "ERR": "ОШИБКА",
  "INFO": "ИНФО",
  "SIM": "СИМУЛЯЦИЯ",
  "COMPARISON": "СРАВНЕНИЕ",
  "MARKET": "РЫНОК",
  "QUOTE": "КОТИРОВКА",
  "CLI": "ТЕРМИНАЛ",
  "CASH": "ДЕНЬГИ",
  "BROKER": "БРОКЕР",
  "ROLLOVER": "ПЕРЕНОС",
  "TV Chart": "График TradingView",
  "TV Ideas": "Идеи TradingView",
  "Check that FREEDOM_PUBLIC_KEY and FREEDOM_PRIVATE_KEY are configured as Cloudflare Worker secrets. Never expose the private key in browser code.": "Проверьте, что FREEDOM_PUBLIC_KEY и FREEDOM_PRIVATE_KEY заданы как секреты Cloudflare Worker. Никогда не раскрывайте закрытый ключ в клиентском коде.",
  "TBD": "Пока неизвестно",
  "No quotes updated during batch fetch.": "Не удалось обновить ни одной котировки в пакетном запросе.",
  "Buy requires a valid ticker, positive share count, and positive price.": "Для покупки укажите корректный тикер, положительное количество акций и положительную цену.",
  "Gemini returned an invalid ticker. No changes were made.": "Gemini вернул некорректный тикер. Изменения не внесены.",
  "Gemini returned an invalid buy quantity or price. No changes were made.": "Gemini вернул некорректное количество акций или цену покупки. Изменения не внесены.",
  "Gemini returned an invalid sale quantity or price. No changes were made.": "Gemini вернул некорректное количество акций или цену продажи. Изменения не внесены.",
  "Gemini returned an invalid price. No changes were made.": "Gemini вернул некорректную цену. Изменения не внесены.",
  "Gemini returned invalid cash holding details. No changes were made.": "Gemini вернул некорректные данные денежной позиции. Изменения не внесены.",
  "Gemini returned an invalid margin balance. No changes were made.": "Gemini вернул некорректный маржинальный баланс. Изменения не внесены.",
  "Gemini returned an invalid account balance. No changes were made.": "Gemini вернул некорректный баланс счёта. Изменения не внесены.",
  "Terminal cleared.": "Терминал очищен.",
  "Refreshing all live quotes...": "Обновление всех актуальных котировок…",
  "Use the same ticker for every exit scenario.": "Во всех сценариях выхода используйте один и тот же тикер.",
  "Exit date must be within the next 10 years.": "Дата выхода должна находиться в пределах следующих 10 лет.",
  "Every exit price must be a positive number.": "Цена выхода должна быть положительным числом.",
  "Provide at least two exit scenarios to compare.": "Для сравнения укажите как минимум два сценария выхода.",
  "Usage: sold <shares|all> <ticker> for <price>": "Формат: sold <shares|all> <ticker> for <price>",
  "Invalid simulation price.": "Некорректная цена для моделирования.",
  "Enter a valid finite amount.": "Введите корректную конечную сумму.",
  "Free cash cannot be negative. Use \"debt <amount>\" to set margin debt.": "Свободные денежные средства не могут быть отрицательными. Используйте \"debt <amount>\", чтобы задать маржинальный долг.",
  "Usage: add cash stock <shares> <ticker> [price]": "Формат: add cash stock <shares> <ticker> [price]",
  "Usage: bought <shares> <ticker> for <price> [, pt <target>] [on <date>]": "Формат: bought <shares> <ticker> for <price> [, pt <target>] [on <date>]",
  "Usage: target <ticker> <price> (for an open margin position)": "Формат: target <ticker> <price> (для открытой маржинальной позиции)",
  "Only administrators can": "Только администраторы могут",
  "[Guest Portfolio Sync Error]": "Ошибка синхронизации гостевого портфеля",
  "[KV Cloud Sync Error]": "Ошибка синхронизации облака KV",
  "[Settings Error]": "Ошибка настроек",
  "[Warning]": "Предупреждение",
  "[Error]": "Ошибка",
  "[Backup]": "Резервная копия",
  "[Backup Import]": "Импорт резервной копии",
  "[Backup Error]": "Ошибка импорта резервной копии",
  "[Executed Buy]": "Покупка выполнена",
  "[Cash Holding Closed]": "Денежная позиция закрыта",
  "[Cash Holding Partial Sell]": "Частичная продажа денежной позиции",
  "[Position Closed]": "Позиция закрыта",
  "[Partial Sell]": "Частичная продажа",
  "[Target Updated]": "Целевая цена обновлена",
  "[Price Unchanged]": "Цена не изменена",
  "[Price Updated]": "Цена обновлена",
  "[Margin Synced]": "Маржинальный баланс синхронизирован",
  "[Balance]": "Баланс",
  "[CLI Error]": "Ошибка команды",
  "[CLI]": "Команда",
  "[AI Advisor]": "Совет ИИ",
  "[System]": "Система",
  "[Broker]": "Брокер",
  "[Freedom]": "Freedom",
  "[Guest Portfolio Sync Error]: Assigned holdings and history could not be refreshed.": "Ошибка синхронизации гостевого портфеля: Не удалось обновить назначенные активы и историю.",
  "[Warning]: No quotes updated during batch fetch.": "[Предупреждение]: Не удалось обновить ни одной котировки в пакетном запросе.",
  "Available Frontend Commands (Zero AI/API Latency):": "Доступные локальные команды терминала (без задержки ИИ/API):",
  "Total fee friction includes buy commission, sell commission, and estimated margin interest. Future prices are assumptions. The action stages a target-price command in the terminal; it does not submit a broker order.": "Общие расходы включают комиссию за покупку, комиссию за продажу и расчётные проценты по марже. Будущие цены являются допущениями. Действие подготавливает команду целевой цены в терминале, но не отправляет брокерский ордер.",
  "Same projection schedule and columns as the main table, recalculated for the hypothetical post-purchase position at the target price (or current quote if no target is set). Fees include buy/sell commissions and accrued margin interest. No portfolio mutation or order placement occurs.": "Тот же график прогнозирования и те же столбцы, что в основной таблице, пересчитанные для гипотетической позиции после покупки по целевой цене (или по текущей котировке, если цель не задана). Расходы включают комиссии за покупку и продажу, а также начисленные проценты по марже. Портфель не изменяется, ордера не отправляются.",
  "Estimate only · no portfolio changes.": "Только оценка · портфель не изменяется.",
  "Today": "Сегодня",
  "Tomorrow": "Завтра",
  "NOW Net": "Чистый результат сейчас",
  "AFTER Net": "Чистый результат после покупки",
  "NOW F&C": "Комиссии и расходы сейчас",
  "AFTER F&C": "Комиссии и расходы после покупки",
  "NOW M Fee": "Маржинальные проценты сейчас",
  "AFTER M Fee": "Маржинальные проценты после покупки",
  "NOW Balance": "Баланс сейчас",
  "AFTER Balance": "Баланс после покупки",
  "Gross Proceeds": "Валовая выручка",
  "Total Fee Friction": "Общие комиссии и расходы",
  "Resulting Account Balance": "Итоговый баланс счёта",
  "Cost Basis": "Себестоимость",
  "Cash needed:": "Необходимая сумма:",
  "Average entry:": "Средняя цена входа:",
  "Net P&L at quote:": "Чистая прибыль/убыток по текущей котировке:",
  "Net P&L at target:": "Чистая прибыль/убыток по целевой цене:",
  "Net P&L at -10%:": "Чистая прибыль/убыток при снижении на 10%:",
  "Final margin balance:": "Итоговый маржинальный баланс:",
  "Extra margin cost:": "Дополнительные расходы по марже:",
  "Trade-off:": "Компромисс:",
  "Switch to 7d": "Переключить на 7 дней",
  "Lock 14d Best": "Зафиксировать лучший вариант на 14 дней",
  "Invert Comparison": "Обратить порядок сравнения",
  "Stage target command": "Подготовить команду целевой цены",
  "Execution failed": "Не удалось выполнить команду",
  "[CLI]: Unrecognized command. Type \"help\" for local commands, or prefix with \"ask ...\" for AI advisor.": "[Команда]: Неизвестная команда. Введите \"help\" для локальных команд или добавьте префикс \"ask ...\" для обращения к ИИ-советнику.",
  "Usage: compare exits [TICKER] today at 190, tomorrow at 191, after 4 days at 193, in 2 weeks at 195, 1 month later at 200": "Формат: compare exits [TICKER] today at 190, tomorrow at 191, after 4 days at 193, in 2 weeks at 195, 1 month later at 200",
  "Select a ticker tab or specify a ticker (e.g., \"sell AAPL today for $180 vs sell 14 days later for $185\").": "Выберите вкладку тикера или укажите тикер (например, \"sell AAPL today for $180 vs sell 14 days later for $185\").",
  "Usage: buy scenario <shares> <ticker> at <price>.": "Формат: buy scenario <shares> <ticker> at <price>.",
  "• bought <shares> <ticker> for <price> (e.g. bought 10 AAPL for $185.50)": "• bought <shares> <ticker> for <price> (например, bought 10 AAPL for $185.50)",
  "• sold <shares|all> <ticker> for <price> (e.g. sold all AAPL for $195)": "• sold <shares|all> <ticker> for <price> (например, sold all AAPL for $195)",
  "• target <ticker> <price> (e.g. target AAPL 210)": "• target <ticker> <price> (например, target AAPL 210)",
  "• quote <ticker> [manual_price] (e.g. quote AAPL or quote AAPL 190)": "• quote <ticker> [manual_price] (например, quote AAPL или quote AAPL 190)",
  "• balance <amount> | debt <amount> (e.g. balance 5000 or debt 1200)": "• balance <amount> | debt <amount> (например, balance 5000 или debt 1200)",
  "• cash add <shares> <ticker> [price] (e.g. cash add 5 MSFT 420)": "• cash add <shares> <ticker> [price] (например, cash add 5 MSFT 420)",
  "• cash remove <ticker> (e.g. cash remove MSFT)": "• cash remove <ticker> (например, cash remove MSFT)",
  "• sell today for <p1> vs sell <N> days later for <p2>": "• sell today for <p1> vs sell <N> days later for <p2> (сравнение цены продажи по датам)",
  "• sim [ticker] <price> in <days> days (e.g. sim AAPL 205 in 14d)": "• sim [ticker] <price> in <days> days (например, sim AAPL 205 in 14d)",
  "• compare exits [ticker] today at <p>, tomorrow at <p>, after 4 days at <p>, 1 week later at <p>": "• compare exits [ticker] today at <p>, tomorrow at <p>, after 4 days at <p>, 1 week later at <p> (сравнение сценариев выхода)",
  "• buy scenario <shares> <ticker> at <price> (read-only add-on purchase simulation)": "• buy scenario <shares> <ticker> at <price> (моделирование дополнительной покупки без изменения портфеля)",
  "• view <ticker|combined|cash> | refresh | clear": "• view <ticker|combined|cash> | refresh | clear (раздел, котировки, очистка терминала)",
};

const TEXT_ATTRIBUTES = ['aria-label', 'alt', 'placeholder', 'title', 'label', 'data-tooltip'] as const;
let currentLanguage: AppLanguage = 'en';
const languageListeners = new Set<(language: AppLanguage) => void>();

export function getAppLanguage(): AppLanguage {
  return currentLanguage;
}

function russianPlural(value: number, one: string, few: string, many: string): string {
  const lastTwo = value % 100;
  const last = value % 10;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

function translateDynamicText(normalized: string): string | undefined {
  const replaceCommandHelp = normalized.match(/^Please replace \[(.+)\] with a value before running this command\.$/i);
  if (replaceCommandHelp) return 'Замените [' + replaceCommandHelp[1] + '] на значение перед выполнением команды.';

  const switchedView = normalized.match(/^Switched view to (.+)\.$/i);
  if (switchedView) {
    const viewNames: Record<string, string> = {
      COMBINED: 'Общий портфель',
      CASH_CUSHION: 'Баланс',
      BALANCE: 'Баланс',
      SETTINGS: 'Настройки',
      CLOSED_HISTORY: 'История закрытых сделок',
      GUEST_HISTORY: 'Лоты'
    };
    return 'Выполнено переключение на раздел ' + (viewNames[switchedView[1]] || switchedView[1]) + '.';
  }

  const invalidCalendarDate = normalized.match(/^Invalid calendar date "(.+)"\. Use YYYY-MM-DD or "Mar 25"\.$/i);
  if (invalidCalendarDate) return 'Некорректная календарная дата "' + invalidCalendarDate[1] + '". Используйте ГГГГ-ММ-ДД или "Mar 25".';
  const invalidDate = normalized.match(/^Invalid date "(.+)"\. Use YYYY-MM-DD or "Mar 25"\.$/i);
  if (invalidDate) return 'Некорректная дата "' + invalidDate[1] + '". Используйте ГГГГ-ММ-ДД или "Mar 25".';
  const unrecognizedDate = normalized.match(/^Unrecognized date "(.+)"\. Try "on YYYY-MM-DD", "on Mar 25", "yesterday", or "3 days ago"\.$/i);
  if (unrecognizedDate) return 'Не удалось распознать дату "' + unrecognizedDate[1] + '". Используйте "on YYYY-MM-DD", "on Mar 25", "yesterday" или "3 days ago".';
  const unrecognizedExitDate = normalized.match(/^Unrecognized exit date:\s*(.+)$/i);
  if (unrecognizedExitDate) return 'Не удалось распознать дату выхода: ' + unrecognizedExitDate[1];

  const noOpenPosition = normalized.match(/^No open position found for (.+)\.$/i);
  if (noOpenPosition) return 'Не найдена открытая позиция ' + noOpenPosition[1] + '.';
  const noOpenScenarioPosition = normalized.match(/^No open position found for (.+)\. Buy scenarios require an existing position\.$/i);
  if (noOpenScenarioPosition) return 'Не найдена открытая позиция ' + noOpenScenarioPosition[1] + '. Для сценария покупки нужна существующая позиция.';
  const noOpenShares = normalized.match(/^No valid open shares found for (.+)\.$/i);
  if (noOpenShares) return 'Не найдено допустимое количество открытых акций для ' + noOpenShares[1] + '.';

  const sold = normalized.match(/^Sold ([\d,.]+) ([A-Z0-9.-]+) @ \$(\d+(?:\.\d{2})?)$/i);
  if (sold) return 'Продано ' + sold[1] + ' акций ' + sold[2] + ' по цене $' + sold[3] + '.';

  const settingsLoadError = normalized.match(/^\[Settings Error\]: Could not load saved broker assumptions \((.+)\)\. Using defaults\.$/i);
  if (settingsLoadError) return '[Ошибка настроек]: Не удалось загрузить сохранённые параметры брокера (' + settingsLoadError[1] + '). Используются значения по умолчанию.';

  const marketDataFailure = normalized.match(/^\[Market Data Error\]: Could not fetch (.+)\. (.+)\. Retained tracked price: (.+)\. Set manually via: price (.+) <number>\.$/i);
  if (marketDataFailure) return '[Ошибка рыночных данных]: Не удалось получить котировку ' + marketDataFailure[1] +
    '. ' + marketDataFailure[2] + '. Сохранена отслеживаемая цена: ' + marketDataFailure[3] +
    '. Установить вручную: price ' + marketDataFailure[4] + ' <number>.';

  const unsupportedAiAction = normalized.match(/^\[AI Action Error\]: Unsupported action "(.+)"\. No changes were made\.$/i);
  if (unsupportedAiAction) return '[Ошибка действия ИИ]: Неподдерживаемое действие "' + unsupportedAiAction[1] + '". Изменения не внесены.';

  const executedBuy = normalized.match(/^\[Executed Buy\]: Added (.+?) (.+?) @ (.+?)\. Outlay: (.+?) \(Comm: (.+?)\)\. Funded: (.+?) cash \| \+(.+?) margin debt\. Free Cash remaining: (.+?)\. Total Margin Debt: -(.+?) \(was -(.+?)\)\.$/i);
  if (executedBuy) return '[Покупка выполнена]: Добавлено ' + executedBuy[1] + ' ' + executedBuy[2] +
    ' @ ' + executedBuy[3] + '. Сумма: ' + executedBuy[4] + ' (комиссия: ' + executedBuy[5] +
    '). Оплачено денежными средствами: ' + executedBuy[6] + ' | +маржинальный долг: ' + executedBuy[7] +
    '. Остаток свободных средств: ' + executedBuy[8] + '. Общий маржинальный долг: -' + executedBuy[9] + ' (до операции: -' + executedBuy[10] + ').';

  const cashClosed = normalized.match(/^\[Cash Holding Closed\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\.$/i);
  if (cashClosed) return '[Денежная позиция закрыта]: Продано ' + cashClosed[1] + ' акций ' + cashClosed[2] +
    ' @ ' + cashClosed[3] + '. Зачислено чистыми: +' + cashClosed[4] +
    ' (погашение долга: ' + cashClosed[5] + ', добавлено свободных средств: ' + cashClosed[6] + ').';

  const cashPartial = normalized.match(/^\[Cash Holding Partial Sell\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Remaining: (.+?) shares\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\.$/i);
  if (cashPartial) return '[Частичная продажа денежной позиции]: Продано ' + cashPartial[1] + ' акций ' + cashPartial[2] +
    ' @ ' + cashPartial[3] + '. Остаток: ' + cashPartial[4] + ' акций. Зачислено чистыми: +' + cashPartial[5] +
    ' (погашение долга: ' + cashPartial[6] + ', добавлено свободных средств: ' + cashPartial[7] + ').';

  const positionClosed = normalized.match(/^\[Position Closed\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\. Remaining Debt: -(.+?)\. Free Cash: (.+?)\.$/i);
  if (positionClosed) return '[Позиция закрыта]: Продано ' + positionClosed[1] + ' акций ' + positionClosed[2] +
    ' @ ' + positionClosed[3] + '. Зачислено чистыми: +' + positionClosed[4] +
    ' (погашение долга: ' + positionClosed[5] + ', добавлено свободных средств: ' + positionClosed[6] +
    '). Остаток долга: -' + positionClosed[7] + '. Свободные средства: ' + positionClosed[8] + '.';

  const partialSell = normalized.match(/^\[Partial Sell\]: Sold ([\d,.]+) ([A-Z0-9.-]+) @ (.+?)\. Net credited: \+(.+?) \(Debt paid: (.+?), Free Cash added: (.+?)\)\. Remaining: (.+?) shares\.$/i);
  if (partialSell) return '[Частичная продажа]: Продано ' + partialSell[1] + ' акций ' + partialSell[2] +
    ' @ ' + partialSell[3] + '. Зачислено чистыми: +' + partialSell[4] +
    ' (погашение долга: ' + partialSell[5] + ', добавлено свободных средств: ' + partialSell[6] +
    '). Остаток: ' + partialSell[7] + ' акций.';

  const targetUpdate = normalized.match(/^\[Target Updated\]: (.+) PT updated to (.+)\.$/i);
  if (targetUpdate) return '[Целевая цена обновлена]: Целевая цена ' + targetUpdate[1] + ' установлена на ' + targetUpdate[2] + '.';
  const priceUnchanged = normalized.match(/^\[Price Unchanged\]: No valid price amount supplied\. Enter: price (.+) <number>\.$/i);
  if (priceUnchanged) return '[Цена не изменена]: Не указана корректная цена. Введите: price ' + priceUnchanged[1] + ' <number>.';
  const priceUpdated = normalized.match(/^\[Price Updated\]: (.+) market price set to (.+)\.$/i);
  if (priceUpdated) return '[Цена обновлена]: Рыночная цена ' + priceUpdated[1] + ' установлена на ' + priceUpdated[2] + '.';
  const marginSynced = normalized.match(/^\[Margin Synced\]: Total margin balance explicitly set to -(.+)\.$/i);
  if (marginSynced) return '[Маржинальный баланс синхронизирован]: Общий маржинальный баланс установлен на -' + marginSynced[1] + '.';

  const cashAdded = normalized.match(/^Added ([\d,.]+) ([A-Z0-9.-]+) to cash holdings(?: @ \$(.+))?\.$/i);
  if (cashAdded) return 'В денежные активы добавлено ' + cashAdded[1] + ' акций ' + cashAdded[2] +
    (cashAdded[3] ? ' по цене $' + cashAdded[3] : '') + '.';
  const cashRemoved = normalized.match(/^Removed ([A-Z0-9.-]+) from cash holdings\.$/i);
  if (cashRemoved) return 'Акции ' + cashRemoved[1] + ' удалены из денежных активов.';

  const balanceUpdated = normalized.match(/^\[Balance\]: Current balance\/debt updated\. Balance: (.+) \| Margin debt: -(.+)\.$/i);
  if (balanceUpdated) return '[Баланс]: Баланс и долг обновлены. Баланс: ' + balanceUpdated[1] + ' | Маржинальный долг: -' + balanceUpdated[2] + '.';
  const balanceAdded = normalized.match(/^\[Balance\]: Added (.+) (.+) to balance holdings\. Syncing online quote\.\.\.$/i);
  if (balanceAdded) return '[Баланс]: В активы баланса добавлено ' + balanceAdded[1] + ' ' + balanceAdded[2] + '. Синхронизация онлайн-котировки…';
  const balanceRemoved = normalized.match(/^\[Balance\]: Removed (.+) from balance holdings\.$/i);
  if (balanceRemoved) return '[Баланс]: ' + balanceRemoved[1] + ' удалён из активов баланса.';

  const hypotheticalSubtitle = normalized.match(/^Hypothetical projection after buying \+(.+) shares at (.+) · no order placed$/i);
  if (hypotheticalSubtitle) return 'Гипотетический прогноз после покупки +' + hypotheticalSubtitle[1] + ' акций по цене ' + hypotheticalSubtitle[2] + ' · ордер не отправляется.';

  const exitPreset = normalized.match(/^(.+) vs (.+)$/i);
  if (exitPreset && (/^today$/i.test(exitPreset[1]) || /\d+\s+days?/i.test(exitPreset[1]))) {
    const day = (value: string) => /^today$/i.test(value) ? 'сегодня' : translateText(value, 'ru');
    return day(exitPreset[1]) + ' и ' + day(exitPreset[2]);
  }

  const exitReportHeader = normalized.match(/^\[(EXIT COMPARISON|MULTI-DATE EXIT COMPARISON|STAGED EXIT):\s*(.+)\]$/i);
  if (exitReportHeader) {
    const labels: Record<string, string> = {
      'EXIT COMPARISON': 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА',
      'MULTI-DATE EXIT COMPARISON': 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА ПО ДАТАМ',
      'STAGED EXIT': 'ПОЭТАПНЫЙ ВЫХОД'
    };
    return '[' + labels[exitReportHeader[1].toUpperCase()] + ': ' + exitReportHeader[2] + ']';
  }
  const buyReportHeader = normalized.match(/^\[BUY MORE:\s*(.+)\]$/i);
  if (buyReportHeader) return '[ДОПОЛНИТЕЛЬНАЯ ПОКУПКА: ' + buyReportHeader[1] + ']';

  const exitResultLine = normalized.match(/^(.+?) · (\$[\d,.]+) → ([+-]?\$[\d,.]+) net P&L( · BEST)?$/i);
  if (exitResultLine) {
    const day = /^today$/i.test(exitResultLine[1]) ? 'Сегодня' : translateText(exitResultLine[1], 'ru');
    return day + ' · ' + exitResultLine[2] + ' → ' + exitResultLine[3] + ' чистая прибыль/убыток' +
      (exitResultLine[4] ? ' · ЛУЧШИЙ' : '');
  }
  const bestExit = normalized.match(/^BEST: (.+) at (\$[\d,.]+) · ([+-]?\$[\d,.]+) net$/i);
  if (bestExit) return 'ЛУЧШИЙ: ' + (/^today$/i.test(bestExit[1]) ? 'сегодня' : translateText(bestExit[1], 'ru')) + ' по цене ' + bestExit[2] + ' · ' + bestExit[3] + ' чистыми';
  const feeNote = normalized.match(/^Fees included: (.+)\.$/i);
  if (feeNote) return 'Учтённые расходы: ' + feeNote[1]
    .replace(/buy commission/gi, 'комиссия за покупку')
    .replace(/sell commission/gi, 'комиссия за продажу')
    .replace(/estimated margin interest/gi, 'расчётные проценты по марже') + '.';

  const buyScenarioLine = normalized.match(/^Cash needed: (.+) incl\. fee$/i);
  if (buyScenarioLine) return 'Необходимая сумма: ' + buyScenarioLine[1] + ' включая комиссию';
  const averageEntry = normalized.match(/^Average entry: (.+) → (.+)$/i);
  if (averageEntry) return 'Средняя цена входа: ' + averageEntry[1] + ' → ' + averageEntry[2];
  const netPnlAt = normalized.match(/^Net P&L at (quote|target|-10%): (.+) → (.+)$/i);
  if (netPnlAt) {
    const label = netPnlAt[1].toLowerCase() === 'quote' ? 'текущей котировке' :
      netPnlAt[1].toLowerCase() === 'target' ? 'целевой цене' : 'снижении на 10%';
    return 'Чистая прибыль/убыток при ' + label + ': ' + netPnlAt[2] + ' → ' + netPnlAt[3];
  }
  const finalMarginBalance = normalized.match(/^Final margin balance: (.+) → (.+)$/i);
  if (finalMarginBalance) return 'Итоговый маржинальный баланс: ' + finalMarginBalance[1] + ' → ' + finalMarginBalance[2];
  const extraMarginCost = normalized.match(/^Extra margin cost: (.+)\/day$/i);
  if (extraMarginCost) return 'Дополнительные расходы по марже: ' + extraMarginCost[1] + '/день';
  const tradeoff = normalized.match(/^Trade-off: quote P&L changes by (.+); downside P&L changes by (.+)\.$/i);
  if (tradeoff) return 'Компромисс: прибыль/убыток по текущей котировке меняется на ' + tradeoff[1] +
    '; прибыль/убыток при снижении цены меняется на ' + tradeoff[2] + '.';


  const liveQuotesRefreshed = normalized.match(/^\[System\]: Live market quotes refreshed for (\d+) assets\.$/i);
  if (liveQuotesRefreshed) return '[Система]: Обновлены актуальные рыночные котировки для ' + liveQuotesRefreshed[1] + ' активов.';

  const adminAction = normalized.match(/^Only administrators can (.+)\.$/i);
  if (adminAction) {
    const actions: Record<string, string> = {
      'reset the portfolio': 'сбрасывать портфель',
      'reset broker rules': 'сбрасывать правила брокера',
      'save broker rules': 'сохранять правила брокера',
      'manage guest assignments': 'управлять назначениями гостям',
      'change guest assignments': 'изменять назначения гостям'
    };
    return 'Только администраторы могут ' + (actions[adminAction[1].toLowerCase()] || adminAction[1]) + '.';
  }

  const backupExport = normalized.match(/^\[Backup\]: Exported state to (.+)\.$/i);
  if (backupExport) return '[Резервная копия]: Состояние экспортировано в файл ' + backupExport[1] + '.';

  const backupImport = normalized.match(/^\[Backup Import\]: Imported (.+) into this browser\. Check KV cloud status for sync results\.$/i);
  if (backupImport) return '[Импорт резервной копии]: Файл ' + backupImport[1] +
    ' импортирован в этот браузер. Проверьте состояние синхронизации с облаком KV.';

  const backupError = normalized.match(/^\[Backup Error\]: Could not import backup \((.+)\)\.$/i);
  if (backupError) return '[Ошибка импорта резервной копии]: Не удалось импортировать резервную копию (' + backupError[1] + ').';
  const backupToast = normalized.match(/^Backup import failed: (.+)$/i);
  if (backupToast) return 'Не удалось импортировать резервную копию: ' + backupToast[1];

  const simulationResult = normalized.match(/^\[Sim (.+) @ \$(.+) in (\d+)d\]: Gross \$(.+) \| Comms -\$(.+) \| Margin -\$(.+) → Net P&L: ([+-])\$(.+)$/i);
  if (simulationResult) {
    return '[Симуляция ' + simulationResult[1] + ' @ $' + simulationResult[2] + ' через ' + simulationResult[3] +
      ' дн.]: Валовая прибыль: $' + simulationResult[4] + ' | Комиссии: -$' + simulationResult[5] +
      ' | Маржинальные проценты: -$' + simulationResult[6] + ' → Чистая прибыль/убыток: ' + simulationResult[7] + '$' + simulationResult[8];
  }

  const prefixes: Array<[string, string, string]> = [
    ['Name for ', 'Name for ', ''],
    ['Role for ', 'Role for ', ''],
    ['Language for ', 'Language for ', ''],
    ['New password for ', 'New password for ', ''],
    ['Updated ', 'Updated', ' '],
    ['Synced: ', 'Synced', ': '],
    ['Synced ', 'Synced', ' '],
    ['MARGIN: ', 'MARGIN', ': '],
    ['Combined Breakeven: ', 'Combined Breakeven', ': '],
    ['Exit Comparison · ', 'Exit Comparison', ' · '],
    ['Buy More Projection · ', 'Buy More Projection', ' · '],
    ['Read news: ', 'Read news', ': '],
    ['Stocktwits unavailable: ', 'Stocktwits unavailable', ': '],
    ['Quote status: ', 'Quote status', ': '],
    ['Assigned stock value: ', 'Assigned stock value', ': '],
    ['Immediately pull latest quote for ', 'Immediately pull latest quote for', ' '],
    ['Review recent news and margin-position risks for ', 'Review recent news and margin-position risks for', ' '],
    ['[AI Action Error]: ', '[AI Action Error]', ': '],
    ['[KV Cloud Error]: ', '[KV Cloud Error]', ': '],
    ['Cloud pull failed: ', 'Cloud pull failed', ': '],
    ['[Market Data Error]: ', '[Market Data Error]', ': '],
    ['[Sell Error]: ', 'Sell Error', ': '],
    ['[Freedom] Active sell target sync: ', '[Freedom] Active sell target sync', ': '],
    ['Market depth · ', 'Market depth', ' · '],
    ['Open market depth for ', 'Open market depth for', ' '],
    ['Unable to process saved closed-history cashflows: ', 'Unable to process saved closed-history cashflows', ': '],
    ['Automatic Freedom cashflow sync failed: ', 'Automatic Freedom cashflow sync failed', ': '],
    ['Freedom cashflow processing failed: ', 'Freedom cashflow processing failed', ': '],
    ['TradeNet live-data session initialization failed: ', 'TradeNet live-data session initialization failed', ': '],
    ['Unable to load TradeNet executed trades: ', 'Unable to load TradeNet executed trades', ': '],
    ['Unable to load active TradeNet orders: ', 'Unable to load active TradeNet orders', ': '],
    ['[Guest Portfolio Sync Error]: ', '[Guest Portfolio Sync Error]', ': '],
    ['[KV Cloud Sync Error]: ', '[KV Cloud Sync Error]', ': '],
    ['[Settings Error]: ', '[Settings Error]', ': '],
    ['[Warning]: ', '[Warning]', ': '],
    ['[Error]: ', '[Error]', ': '],
    ['[Backup]: ', '[Backup]', ': '],
    ['[Backup Import]: ', '[Backup Import]', ': '],
    ['[Backup Error]: ', '[Backup Error]', ': '],
    ['[CLI Error]: ', '[CLI Error]', ': '],
    ['[CLI]: ', '[CLI]', ': '],
    ['[AI Advisor]: ', '[AI Advisor]', ': '],
    ['[System]: ', '[System]', ': '],
  ];
  for (const [prefix, dictionaryKey, separator] of prefixes) {
    if (normalized.startsWith(prefix)) {
      return (RU[dictionaryKey] || dictionaryKey) + separator + normalized.slice(prefix.length);
    }
  }

  const latestPortfolioQuote = normalized.match(/^Latest portfolio quote · (.+)$/i);
  if (latestPortfolioQuote) {
    return RU['Latest portfolio quote'] + ' · ' + translateText(latestPortfolioQuote[1], 'ru');
  }

  const acrossAssets = normalized.match(/^(.+) \| Across (\d+) Assets$/i);
  if (acrossAssets) {
    const count = Number(acrossAssets[2]);
    return acrossAssets[1] + ' | По ' + count + (count === 1 ? ' активу' : ' активам');
  }

  const trancheSummary = normalized.split(' | ').map((part) => {
    const match = part.match(/^(.+?): ([\d,.]+)sh @ PT (.+)$/i);
    return match ? match[1] + ': ' + match[2] + ' акц. @ ЦУ ' + match[3] : part;
  });
  if (trancheSummary.some((part, index) => part !== normalized.split(' | ')[index])) {
    return trancheSummary.join(' | ');
  }

  const externalLinkLabel = normalized.match(/^Open (.+) on (.+) in a new tab$/i);
  if (externalLinkLabel) {
    const provider = RU[externalLinkLabel[2]] || externalLinkLabel[2];
    return 'Открыть ' + externalLinkLabel[1] + ' через ' + provider + ' в новой вкладке';
  }

  const missingMarginPosition = normalized.match(/^No active margin position was found for (.+)\. Select an active margin ticker and try again\.$/i);
  if (missingMarginPosition) {
    return 'Не найдена активная маржинальная позиция ' + missingMarginPosition[1] +
      '. Выберите активный маржинальный тикер и повторите попытку.';
  }

  const positionReviewTitle = normalized.match(/^(.+) · Position Review$/i);
  if (positionReviewTitle) return positionReviewTitle[1] + ' · Анализ маржинальной позиции';

  const reportTitles: Array<[string, string]> = [
    ['HYPOTHETICAL BUY:', 'ПОКУПКА В СЦЕНАРИИ:'],
    ['MULTI-DATE EXIT COMPARISON:', 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА ПО ДАТАМ:'],
    ['EXIT COMPARISON:', 'СРАВНЕНИЕ ВАРИАНТОВ ВЫХОДА:'],
    ['STAGED EXIT:', 'ПОЭТАПНЫЙ ВЫХОД:']
  ];
  for (const [prefix, translatedPrefix] of reportTitles) {
    if (normalized.toUpperCase().startsWith(prefix)) {
      return translatedPrefix + normalized.slice(prefix.length);
    }
  }

  const rows = normalized.match(/^Rows (.+) of (\d+)$/i);
  if (rows) return `Строки ${rows[1]} из ${rows[2]}`;
  const page = normalized.match(/^Page (\d+) of (\d+)$/i);
  if (page) return `Страница ${page[1]} из ${page[2]}`;
  const milestone = normalized.match(/^(EOW|NTD) · \+(\d+)d$/i);
  if (milestone) {
    const label = milestone[1].toUpperCase() === 'EOW' ? 'До конца недели' : 'Следующий торговый день';
    return `${label} · +${milestone[2]} дн.`;
  }
  const positionValue = normalized.match(/^Position value ([\d,]+(?:\.[\d]+)?)(?: \(already\s*([\d.,]+)% below trigger\))?$/i);
  if (positionValue) {
    return positionValue[2]
      ? `Стоимость позиции ${positionValue[1]} (уже на ${positionValue[2]}% ниже порога)`
      : `Стоимость позиции ${positionValue[1]}`;
  }

  const buffer = normalized.match(/^([\d.,]+)% buffer$/i);
  if (buffer) return 'Запас: ' + buffer[1] + '%';

  const recordRange = normalized.match(/^(\d+) [/] (\d+) records$/i);
  if (recordRange) {
    const total = Number(recordRange[2]);
    return recordRange[1] + ' / ' + recordRange[2] + ' ' + russianPlural(total, 'запись', 'записи', 'записей');
  }

  const unassigned = normalized.match(/^(· )?(\d+) unassigned$/i);
  if (unassigned) return (unassigned[1] || '') + 'Без назначения: ' + unassigned[2];

  const showTranches = normalized.match(/^Show (\d+) tranches$/i);
  if (showTranches) {
    return `Показать ${showTranches[1]} ${russianPlural(Number(showTranches[1]), 'лот', 'лота', 'лотов')}`;
  }

  const count = normalized.match(/^(\d+) (tranches|records|holdings|days|hrs|shares)$/i);
  if (count) {
    const amount = Number(count[1]);
    const noun = count[2].toLowerCase();
    if (noun === 'tranches') return `${amount} ${russianPlural(amount, 'лот', 'лота', 'лотов')}`;
    if (noun === 'records') return `${amount} ${russianPlural(amount, 'запись', 'записи', 'записей')}`;
    if (noun === 'holdings') return `${amount} ${russianPlural(amount, 'позиция', 'позиции', 'позиций')}`;
    if (noun === 'days') return `${amount} дн.`;
    if (noun === 'hrs') return `${amount} ч`;
    return `${amount} акций`;
  }

  const riskPrefixes = ['Healthy', 'No margin debt', 'Elevated', 'Stop-out level', 'Margin-call level'];
  const riskPrefix = riskPrefixes.find((prefix) => normalized === prefix || normalized.startsWith(prefix + ' ·'));
  if (riskPrefix) {
    return (RU[riskPrefix] || riskPrefix) + normalized.slice(riskPrefix.length)
      .replace(/\bnegative equity\b/g, RU['negative equity'])
      .replace(/\bequity\b/g, 'собственного капитала')
      .replace(/\bmaintenance\b/g, 'по нормативу поддерживающей маржи');
  }

  if (normalized.startsWith('e.g. quote ')) {
    return 'например: quote ' + normalized.slice('e.g. quote '.length);
  }
  return undefined;
}

export function translateText(value: string, language: AppLanguage = currentLanguage): string {
  if (language === 'en') return value;
  if (value.includes('\n')) return value.split('\n').map((line) => translateText(line, language)).join('\n');
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, ' ');
  if (!normalized) return value;
  const translated = RU[normalized] ?? translateDynamicText(normalized);
  if (!translated) return value;
  const start = value.indexOf(trimmed);
  const end = start + trimmed.length;
  return value.slice(0, start) + translated + value.slice(end);
}

function translateVNodeValue(value: unknown): unknown {
  if (typeof value === 'string') return translateText(value);
  if (Array.isArray(value)) return value.map(translateVNodeValue);
  if (value && typeof value === 'object' && 'props' in value) {
    const props = (value as VNode).props as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(props, 'children')) {
      props.children = translateVNodeValue(props.children);
    }
    for (const attribute of TEXT_ATTRIBUTES) {
      const attributeValue = props[attribute];
      if (typeof attributeValue === 'string') {
        props[attribute] = translateText(attributeValue);
      }
    }
  }
  return value;
}

const previousVNodeHook = options.vnode;
options.vnode = (vnode) => {
  previousVNodeHook?.(vnode);
  translateVNodeValue(vnode);
};

function updateDocumentLanguage(language: AppLanguage): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title = language === 'ru' ? RU_DOCUMENT_TITLE : EN_DOCUMENT_TITLE;
}

export function setAppLanguage(language: AppLanguage | null | undefined): void {
  const nextLanguage: AppLanguage = language === 'ru' ? 'ru' : 'en';
  updateDocumentLanguage(nextLanguage);
  if (currentLanguage === nextLanguage) return;
  currentLanguage = nextLanguage;
  for (const listener of languageListeners) listener(nextLanguage);
}

export function subscribeAppLanguage(listener: (language: AppLanguage) => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}
