import { options, type VNode } from 'preact';

export type AppLanguage = 'en' | 'ru';

const EN_DOCUMENT_TITLE = 'Margin Portfolio Terminal — Tradernet Armenia Edition';
const RU_DOCUMENT_TITLE = 'Маржинальный портфель — терминал Tradernet (Армения)';

/** Exact UI copy translations. Dynamic portfolio values and user-entered data are left untouched. */
const RU: Record<string, string> = {
  'MARGIN DESK': 'МАРЖИНАЛЬНЫЙ РАЗДЕЛ',
  'COMBINED PORTFOLIO': 'ОБЩИЙ ПОРТФЕЛЬ',
  '🛡️ BALANCE': '🛡️ БАЛАНС',
  'CLOSED HISTORY': 'ИСТОРИЯ ЗАКРЫТЫХ СДЕЛОК',
  '⚙️ SETTINGS': '⚙️ НАСТРОЙКИ',
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
  'PT': 'Цель',
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
  'Shares': 'Акции',
  'Avg. Cost': 'Средняя стоимость',
  'Value': 'Стоимость',
  'Operation': 'Операция',
  'Guest · cash shares': 'Гость · акции за собственные средства',
  'Cash': 'Денежные средства',
  'Margin': 'Маржа',
  'Mix': 'Смешанное',
  'Unassigned': 'Не назначено',
  'Guest unavailable': 'Гость недоступен',
  'No guest accounts': 'Нет гостевых учётных записей',
  'No cash allocation': 'Нет распределения денежных средств',
  'Your active stock cards': 'Карточки ваших активных акций',
  'Market value minus average purchase value': 'Рыночная стоимость за вычетом средней цены покупки',
  'Closed Trade History': 'История закрытых сделок',
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
  "YOUR ASSIGNED STOCKS": "НАЗНАЧЕННЫЕ ВАМ АКЦИИ",
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
  "Elevated": "Повышенный",
  "None": "Нет",
  "No live quotes fetched for margin positions": "Для маржинальных позиций ещё не получены актуальные котировки",
  "Latest portfolio quote": "Последняя котировка портфеля",
  "maintenance": "поддерживающая маржа",
  "equity": "собственный капитал",
  "Account equity health": "Состояние собственного капитала счёта",
  "Direction": "Направление",
  "Operation №": "Операция №",
  "No cashflow rows were found in this workbook.": "В этой книге не найдены строки движения денежных средств.",
  "Cashflow import failed.": "Не удалось импортировать движение денежных средств.",
  "Importing…": "Импорт…",
  "Import Cashflows": "Импортировать движение денежных средств",
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
  "This browser cannot unpack the XLSX workbook.": "Этот браузер не может распаковать книгу XLSX.",
  "Unsupported XLSX ZIP64 archive.": "Архив XLSX в формате ZIP64 не поддерживается.",
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
    ['Review recent news and margin-position risks for ', 'Review recent news and margin-position risks for', ' ']
  ];
  for (const [prefix, dictionaryKey, separator] of prefixes) {
    if (normalized.startsWith(prefix)) {
      return (RU[dictionaryKey] || dictionaryKey) + separator + normalized.slice(prefix.length);
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
      .replace(/\bequity\b/g, 'собственного капитала')
      .replace(/\bmaintenance\b/g, 'поддерживающая маржа');
  }

  if (normalized.startsWith('e.g. quote ')) {
    return 'например: quote ' + normalized.slice('e.g. quote '.length);
  }
  return undefined;
}

export function translateText(value: string, language: AppLanguage = currentLanguage): string {
  if (language === 'en') return value;
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
