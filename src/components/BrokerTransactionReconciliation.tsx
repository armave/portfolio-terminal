import { useState } from 'preact/hooks';
import type { BrokerCashflow, BrokerExecution } from '../types/broker';
import type { CashStockHolding, ClosedTrade, PositionRecord } from '../types/portfolio';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { reconcileBrokerActivity, type ReconciliationFeedStatus } from '../domain/brokerTransactionReconciliation';
import { inspectPortfolioTransactionJournalReplayCoverage } from '../domain/portfolioTransactionJournal';
import { verifyPortfolioTransactionLotParity, type PortfolioLotParityResult } from '../domain/portfolioLotJournal';
import { getAppLanguage } from '../services/i18n';
import {
  reconcileBrokerQuotePrices,
  type AppQuoteHolding,
  type BrokerQuoteSnapshot,
  type BrokerQuoteReconciliationStatus
} from '../domain/brokerQuoteReconciliation';

export type BrokerReconciliationReviewSection = 'activity' | 'quote';
type RecordBrokerReconciliationReview = (
  section: BrokerReconciliationReviewSection,
  findingId: string,
  findingType: string,
  subject: string,
  reason: string
) => boolean;

export function getBrokerReconciliationReviewIdempotencyKey(
  section: BrokerReconciliationReviewSection,
  findingId: string
): string {
  const id = typeof findingId === 'string' ? findingId.trim() : '';
  if (!id || id.length > 160) return '';
  return `reconciliation-review:${section}:${id}`;
}

export function findBrokerReconciliationReview(
  events: readonly PortfolioTransactionEvent[],
  section: BrokerReconciliationReviewSection,
  findingId: string
): PortfolioTransactionEvent | undefined {
  const key = getBrokerReconciliationReviewIdempotencyKey(section, findingId);
  if (!key) return undefined;
  return events.find((event) =>
    event.type === 'portfolio.reconciliation' &&
    event.actor.type === 'user' &&
    event.source === 'broker-reconciliation-review' &&
    event.idempotencyKey === key &&
    Boolean(event.requestFingerprint?.trim()) &&
    Boolean(event.note?.trim()) &&
    event.positionQuantityDelta === undefined &&
    event.cashHoldingQuantityDelta === undefined &&
    event.cashDelta === undefined &&
    event.marginDebtDelta === undefined
  );
}

const RU_COPY: Record<string, string> = {
  'Reconcile broker activity': 'Сверить активность брокера',
  'Matched': 'Совпадает',
  'Differences found': 'Обнаружены расхождения',
  'History unavailable': 'История недоступна',
  'Provisional review': 'Предварительная проверка',
  'findings': 'расхождений',
  'Read-only comparison of broker executions and cashflows with app-authored journal events. No portfolio data is changed.': 'Сверка исполнений и денежных потоков брокера с журналом операций приложения. Данные портфеля не изменяются.',
  'Review item': 'Отметить проверенным',
  'Reason for review': 'Причина проверки',
  'Record review': 'Записать проверку',
  'Cancel': 'Отмена',
  'Reviewed · not resolved': 'Проверено · не устранено',
  'This is an audit note only. It does not resolve the finding or change portfolio data.': 'Это только запись в аудите. Она не устраняет расхождение и не изменяет данные портфеля.',
  'Enter a reason to record this review.': 'Укажите причину для записи проверки.',
  'Review could not be recorded. No financial data was changed.': 'Не удалось записать проверку. Финансовые данные не изменены.',
  'Reviewed note': 'Записанная причина проверки',
  'Record a review note only; corrections and writeback remain unavailable.': 'Записывается только отметка о проверке; исправления и запись изменений недоступны.',
  'Broker executions': 'Исполнения брокера',
  'Matched executions': 'Совпавшие исполнения',
  'Broker cashflows': 'Денежные потоки брокера',
  'Matched cashflows': 'Совпавшие денежные потоки',
  'App journal executions': 'Исполнения в журнале приложения',
  'App journal cashflows': 'Денежные потоки в журнале приложения',
  'Legacy closed sales': 'Исторические закрытые продажи',
  'Matched legacy sales': 'Совпавшие исторические продажи',
  'Matched legacy sell fills': 'Совпавшие исполнения исторических продаж',
  'provisional items': 'предварительных записей',
  'No confirmed differences were found in the available records; incomplete coverage prevents a full match confirmation.': 'В доступных записях не обнаружено подтверждённых расхождений; неполнота истории не позволяет подтвердить полное совпадение.',
  'Broker history is unavailable; no transaction-level comparison could be confirmed.': 'История брокера недоступна; сверку на уровне транзакций подтвердить невозможно.',
  'Duplicate broker execution': 'Дублирующееся исполнение брокера',
  'Broker execution revision conflict': 'Конфликт версий исполнения брокера',
  'Ambiguous broker order match': 'Неоднозначное совпадение ордера брокера',
  'Unclassified broker execution': 'Нераспознанное исполнение брокера',
  'Duplicate broker cashflow': 'Дублирующийся денежный поток брокера',
  'Broker cashflow revision conflict': 'Конфликт версий денежного потока брокера',
  'Unclassified broker cashflow': 'Нераспознанный денежный поток брокера',
  'Cashflow direction differs': 'Направление денежного потока отличается',
  'Ambiguous broker cashflow match': 'Неоднозначное сопоставление денежного потока брокера',
  'Execution not found in app journal': 'Исполнение не найдено в журнале приложения',
  'App trade not found in broker history': 'Сделка приложения не найдена в истории брокера',
  'Execution quantity differs': 'Количество исполнения отличается',
  'Execution price differs': 'Цена исполнения отличается',
  'Commission differs': 'Комиссия отличается',
  'Commission currency differs': 'Валюта комиссии отличается',
  'Execution timestamp differs': 'Время исполнения отличается',
  'Cashflow not found in app journal': 'Денежный поток не найден в журнале приложения',
  'App cashflow not found in broker history': 'Денежный поток приложения не найден в истории брокера',
  'Cashflow amount differs': 'Сумма денежного потока отличается',
  'Cashflow currency differs': 'Валюта денежного потока отличается',
  'Cashflow classification differs': 'Классификация денежного потока отличается',
  'Confirmed': 'Подтверждено',
  'Provisional': 'Предварительно',
  'Broker': 'Брокер',
  'App': 'Приложение',
  'Broker ref': 'ID брокера',
  'App event': 'Событие приложения',
  'Showing first 30 findings': 'Показаны первые 30 расхождений',
  'No transaction-level differences were found in the available records.': 'В доступных записях расхождений на уровне транзакций не обнаружено.',
  'Unmatched records remain provisional until transaction journal coverage is complete. Resolution and writeback are not available in this read-only review.': 'Несовпавшие записи остаются предварительными до полного охвата журнала транзакций. В этой проверке доступны только просмотр и сверка, без исправлений и записи данных.',
  'Legacy closed-sale summaries are matched only when the broker sell fills agree on ticker, date, total quantity and weighted price. They do not establish historical buy executions or cashflows.': 'Исторические сводки закрытых продаж сопоставляются только при совпадении тикера, даты, общего количества и средневзвешенной цены исполнений продажи. Они не подтверждают исторические покупки или денежные потоки.',
  'Legacy closed sales are app summaries, not transaction-journal events.': 'Исторические закрытые продажи — это сводки приложения, а не события журнала транзакций.',
  'The broker execution history is incomplete; absence-based findings are suppressed.': 'История исполнений брокера неполная; выводы об отсутствии записей не делаются.',
  'Broker cashflow history is incomplete; absence-based findings are suppressed.': 'История денежных потоков брокера неполная; выводы об отсутствии записей не делаются.',
  'App transaction journal coverage is incomplete; unmatched records are provisional and are not treated as confirmed omissions.': 'Журнал транзакций приложения заполнен не полностью; несовпавшие записи предварительные и не считаются подтверждёнными пропусками.',
  'The broker and app cashflow records use different currencies; no conversion was attempted.': 'Записи денежных потоков брокера и приложения используют разные валюты; конвертация не выполнялась.',
  'More than one broker order has fills that match this app transaction. No order was selected without a unique match.': 'Несколько ордеров брокера соответствуют этой транзакции приложения. Ордер не выбран, поскольку совпадение неоднозначно.',
  'Multiple nearby broker fills could represent this app transaction, but they do not share a verified order ID. No fills were grouped.': 'Несколько близких по времени исполнений могут относиться к транзакции приложения, но у них нет общего подтверждённого ID ордера. Исполнения не объединялись.',
  'More than one broker order has fills that match an app transaction; manual review is required.': 'Несколько ордеров брокера могут соответствовать транзакции приложения; требуется ручная проверка.',
  'Multiple nearby broker fills lack a shared verified order ID; partial-fill matching was not attempted.': 'У близких по времени исполнений нет общего подтверждённого ID ордера; объединение частичных исполнений не выполнялось.',
  'The same broker execution identifier appears with conflicting facts. No revision was selected because the feed does not identify which record supersedes the other.': 'Один и тот же идентификатор исполнения брокера содержит противоречивые данные. Версия не выбрана, поскольку поток не указывает, какая запись заменяет другую.',
  'The broker execution is missing a usable instrument, supported side or positive quantity and was excluded from matching.': 'В исполнении брокера отсутствует допустимый инструмент, поддерживаемая сторона или положительное количество; запись исключена из сверки.',
  'The same broker cashflow identifier appears with conflicting facts. No revision was selected because the feed does not identify which record supersedes the other.': 'Один и тот же идентификатор денежного потока брокера содержит противоречивые данные. Версия не выбрана, поскольку поток не указывает, какая запись заменяет другую.',
  'The broker cashflow could not be safely classified or had no usable amount and was excluded from matching.': 'Не удалось безопасно классифицировать денежный поток брокера или определить допустимую сумму; запись исключена из сверки.',
  'A broker cashflow has multiple equally strong app fallback candidates; manual review is required.': 'Для денежного потока брокера найдено несколько одинаково подходящих записей приложения; требуется ручная проверка.',
  'More than one app-authored cashflow is an equally strong fallback match for this broker cashflow. No candidate was selected.': 'Несколько денежных потоков приложения одинаково подходят для сопоставления с этим потоком брокера. Ни одна запись не выбрана.',
  'The broker and app record opposite signed cash movements for the same cashflow. No balance adjustment was made.': 'Брокер и приложение указывают противоположные знаки одного денежного потока. Баланс не корректировался.',
  'The broker history contains the same execution identifier and facts more than once.': 'В истории брокера несколько раз встречается один идентификатор исполнения с одинаковыми данными.',
  'The broker history contains the same cashflow identifier and facts more than once.': 'В истории брокера несколько раз встречается один идентификатор денежного потока с одинаковыми данными.',
  'One or more broker execution rows could not be classified; affected rows were excluded from matching.': 'Некоторые исполнения брокера не удалось распознать; такие записи исключены из сверки.',
  'One or more broker cashflow rows could not be classified; affected rows were excluded from matching.': 'Некоторые денежные потоки брокера не удалось распознать; такие записи исключены из сверки.',
  'One or more broker executions lack a provider-stable execution ID; matching is provisional.': 'У некоторых исполнений отсутствует стабильный идентификатор брокера; сверка предварительная.',
  'One or more broker execution IDs have conflicting revisions; affected records were excluded from matching.': 'Некоторые идентификаторы исполнений содержат конфликтующие версии; такие записи исключены из сверки.',
  'One or more broker cashflows lack a provider-stable cashflow ID; matching is provisional.': 'У некоторых денежных потоков отсутствует стабильный идентификатор брокера; сверка предварительная.',
  'One or more broker cashflow IDs have conflicting revisions; affected records were excluded from matching.': 'Некоторые идентификаторы денежных потоков содержат конфликтующие версии; такие записи исключены из сверки.',
  'No corresponding app-authored trade was found in the available transaction journal.': 'В доступном журнале транзакций не найдена соответствующая сделка приложения.',
  'No corresponding broker execution was found in the available provider history.': 'В доступной истории провайдера не найдено соответствующее исполнение брокера.',
  'The broker fill quantity differs from the app transaction quantity.': 'Количество исполнения брокера отличается от количества в транзакции приложения.',
  'The broker execution price differs from the app transaction price.': 'Цена исполнения брокера отличается от цены транзакции приложения.',
  'The broker commission differs from the app-recorded transaction fee.': 'Комиссия брокера отличается от комиссии, записанной в приложении.',
  'The broker and app transaction fees use different currencies; no conversion was attempted.': 'Комиссии брокера и приложения указаны в разных валютах; конвертация не выполнялась.',
  'The broker and app transaction timestamps differ beyond the normal matching tolerance.': 'Время транзакции брокера и приложения отличается больше допустимого интервала сверки.',
  'No corresponding app-authored cashflow event was found in the available journal.': 'В доступном журнале не найдено соответствующее событие денежного потока приложения.',
  'No corresponding broker cashflow was found in the available provider history.': 'В доступной истории провайдера не найден соответствующий денежный поток брокера.',
  'Broker time': 'Время брокера',
  'App time': 'Время приложения',
  'Broker market prices': 'Рыночные цены брокера',
  'Read-only comparison of app quote observations with broker-reported position prices. No portfolio data is changed.': 'Сверка котировок приложения с ценами позиций, сообщёнными брокером. Данные портфеля не изменяются.',
  'Price differences found': 'Обнаружены расхождения цен',
  'Prices matched': 'Цены совпадают',
  'Provisional price comparison': 'Предварительная сверка цен',
  'Stale broker quote snapshot': 'Устаревший снимок котировок брокера',
  'Broker quote data unavailable': 'Данные котировок брокера недоступны',
  'Compared quote pairs': 'Сопоставленные пары котировок',
  'Price mismatch': 'Расхождение цены',
  'Quote currency mismatch': 'Несовпадение валюты котировки',
  'Conflicting app quotes': 'Противоречивые котировки приложения',
  'Conflicting broker prices': 'Противоречивые цены брокера',
  'App quote': 'Котировка приложения',
  'Broker quote': 'Котировка брокера',
  'App quote source': 'Источник котировки приложения',
  'Broker quote source': 'Источник котировки брокера',
  'App observation': 'Наблюдение приложения',
  'Broker observation': 'Наблюдение брокера',
  'Received': 'Получено',
  'App received': 'Получено приложением',
  'Broker received': 'Получено брокером',
  'App currency': 'Валюта приложения',
  'Broker currency': 'Валюта брокера',
  'The app and broker quotes use different or unverified currencies. No conversion was attempted.': 'Котировки приложения и брокера указаны в разных или неподтверждённых валютах. Конвертация не выполнялась.',
  'The reported prices differ, but one or both source observations are incomplete, stale, delayed, or unverifiable.': 'Указанные цены различаются, но одно или оба исходных наблюдения неполные, устаревшие, задержанные или не подтверждены.',
  'The app and broker report different prices for the same currency-qualified instrument with fresh source observations.': 'Приложение и брокер сообщают разные цены для одного инструмента в одинаковой валюте с актуальными исходными наблюдениями.',
  'No matching ticker and currency pairs were available for price comparison.': 'Не найдено совпадающих пар тикера и валюты для сравнения цен.',
  'The broker quote snapshot is stale; it is not used as current price evidence.': 'Снимок котировок брокера устарел и не используется как актуальное подтверждение цены.',
  'The broker provider observation timestamp is unknown; price findings cannot be confirmed.': 'Время наблюдения провайдера брокера неизвестно; расхождения цен нельзя подтвердить.',
  'The broker position snapshot is incomplete; price findings are provisional.': 'Снимок позиций брокера неполный; расхождения цен считаются предварительными.',
  'One or more app quote observations are not verified as fresh, live, and complete.': 'Одна или несколько котировок приложения не подтверждены как актуальные, текущие и полные.',
  'App transaction journal coverage': 'Покрытие журнала транзакций приложения',
  'Complete within scope': 'Полное в пределах указанной области',
  'Incomplete': 'Неполное',
  'Unsupported': 'Не поддерживается',
  'Replayable events': 'Воспроизводимые события',
  'Evidence-only events': 'Только подтверждающие записи',
  'Audit-only events': 'Только аудиторские записи',
  'Items needing review': 'Записи, требующие проверки',
  'Coverage applies to position quantities, cash-holding quantities, free cash, margin debt and realized margin charges. It does not certify lot cost basis or closed-trade P&L reconstruction.': 'Покрытие относится к количеству активных и денежных позиций, свободным денежным средствам, маржинальному долгу и признанным маржинальным расходам. Оно не подтверждает восстановление себестоимости лотов или прибыли и убытка по закрытым сделкам.',
  'No journal replay issues were detected for the current coverage scope.': 'В пределах текущей области проверки проблем воспроизведения журнала не обнаружено.',
  'Showing first 5 coverage findings': 'Показаны первые 5 замечаний по покрытию',
  'Event is malformed or uses an unsupported transaction schema.': 'Событие имеет некорректную структуру или использует неподдерживаемую схему транзакций.',
  'Journal contains a duplicate transaction event ID; replay is blocked to prevent applying the same event more than once.': 'В журнале повторяется идентификатор события транзакции; воспроизведение заблокировано, чтобы не применить одно событие более одного раза.',
  'Journal contains a duplicate transaction idempotency key; replay is blocked to prevent applying the same command more than once.': 'В журнале повторяется ключ идемпотентности транзакции; воспроизведение заблокировано, чтобы не применить одну команду более одного раза.',
  'Broker execution evidence must not post directly to app-owned portfolio balances.': 'Подтверждение исполнения брокера не должно напрямую изменять балансы портфеля приложения.',
  'Broker execution evidence is missing its source reference, instrument, side or quantity.': 'В подтверждении исполнения брокера отсутствует ссылка на источник, инструмент, направление или количество.',
  'Closed-history fee corrections must not post cash, debt, quantity or realized-margin deltas.': 'Корректировки комиссий закрытых сделок не должны изменять денежные средства, долг, количество активов или признанные маржинальные расходы.',
  'History correction requires a stable closed-trade ID, linked app sale event, immutable fee/P&L snapshots and a valid revision chain.': 'Для корректировки истории необходимы стабильный ID закрытой сделки, связанное событие продажи приложения, неизменяемые снимки комиссий и прибыли/убытка, а также корректная цепочка версий.',
  'Trade event requires an instrument, positive quantity and matching signed position delta.': 'Событию сделки необходимы инструмент, положительное количество и соответствующее знаковое изменение позиции.',
  'Cash-holding buy is missing a stable lot ID, acquisition date, price, fee evidence or matching quantity delta.': 'Для покупки денежного актива отсутствуют стабильный ID лота, дата приобретения, цена, сведения о комиссии или соответствующее изменение количества.',
  'Cash-holding sale is missing exact FIFO lot allocations or a matching negative quantity delta.': 'Для продажи денежного актива отсутствуют точные FIFO-распределения по лотам или соответствующее отрицательное изменение количества.',
  'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics.': 'Удаление денежного актива является корректировкой учёта без выручки от продажи или расчёта реализованной прибыли/убытка.',
  'Position adjustment requires an instrument and an explicit quantity delta.': 'Для корректировки позиции необходимы инструмент и явное изменение количества.',
  'Snapshot reconciliation has no explicit state delta or complete audit-review contract.': 'Для сверки снимка отсутствует явное изменение состояния или полный контракт аудиторской проверки.',
  'Cash adjustment requires an explicit free-cash or margin-debt delta.': 'Для корректировки денежных средств необходимо явное изменение свободных средств или маржинального долга.',
  'Margin adjustment requires an explicit debt delta.': 'Для корректировки маржи необходимо явное изменение долга.',
  'Margin-interest event requires explicit debt and realized-charge deltas; legacy events without the realized-charge delta remain incomplete.': 'Для события маржинальных процентов необходимы явные изменения долга и признанных расходов; старые события без изменения признанных расходов остаются неполными.',
  'Financial correction requires an original event reference, reason and non-zero inverse state delta.': 'Для финансовой корректировки необходимы ссылка на исходное событие, причина и ненулевое обратное изменение состояния.',
  'Financial correction references an event that is not present in the supplied journal.': 'Финансовая корректировка ссылается на событие, отсутствующее в предоставленном журнале.',
  'Only cash/debt balance-adjustment reversals are currently supported; trade, lot and corporate-action reversals remain gated.': 'Сейчас поддерживается отмена только корректировок денежных средств и долга; отмена сделок, лотов и корпоративных действий пока недоступна.',
  'Correction state deltas must be the exact inverse of the linked original balance adjustment.': 'Изменения состояния в корректировке должны точно отменять изменения исходной корректировки баланса.',
  'Financial posting has neither an app-owned state delta nor a complete external evidence reference.': 'Финансовая запись не содержит ни изменения состояния приложения, ни полной ссылки на внешнее подтверждение.',
  'Event type is not supported by the current quantity/cash/debt replay contract.': 'Тип события не поддерживается текущим контрактом воспроизведения количества активов, денежных средств и долга.',
  'Lot and closed-trade replay parity': 'Сверка воспроизведения лотов и закрытых сделок',
  'Matched within supported history': 'Совпадение в пределах поддерживаемой истории',
  'Open lots replayed': 'Воспроизведённые открытые лоты',
  'Closed sales replayed': 'Воспроизведённые закрытые продажи',
  'Differences': 'Расхождения',
  'Compares app-owned acquisition lots, FIFO sale allocations and linked closed-trade values. Legacy or unmapped history remains incomplete; no portfolio data is changed.': 'Сверяются лоты приобретения приложения, распределение продаж по FIFO и связанные значения закрытых сделок. История старого формата или без сопоставления остаётся неполной; данные портфеля не изменяются.',
  'Replay and canonical values are shown only as read-only evidence.': 'Значения воспроизведения и канонического состояния показаны только как справочные данные.',
  'No lot or closed-trade replay differences were detected for the supplied history.': 'В предоставленной истории не обнаружено расхождений при воспроизведении лотов и закрытых сделок.',
  'Showing first 5 lot replay differences': 'Показаны первые 5 расхождений воспроизведения лотов',
  'Showing first 5 lot replay issues': 'Показаны первые 5 замечаний воспроизведения лотов',
  'Replay': 'Воспроизведение',
  'Canonical': 'Каноническое состояние',
  'Identity': 'Идентификатор',
  'Open lot missing': 'Отсутствует открытый лот',
  'Open lot quantity differs': 'Количество открытого лота отличается',
  'Open lot cost basis differs': 'Себестоимость открытого лота отличается',
  'Open lot acquisition date differs': 'Дата приобретения открытого лота отличается',
  'Open lot buy commission differs': 'Комиссия покупки открытого лота отличается',
  'Cash-holding lot missing': 'Отсутствует лот денежного актива',
  'Cash-holding lot quantity differs': 'Количество лота денежного актива отличается',
  'Cash-holding lot cost basis differs': 'Себестоимость лота денежного актива отличается',
  'Cash-holding lot acquisition date differs': 'Дата приобретения лота денежного актива отличается',
  'Cash-holding lot buy commission differs': 'Комиссия покупки лота денежного актива отличается',
  'Position lot quantity differs': 'Количество лотов позиции отличается',
  'Position buy commission differs': 'Комиссия покупки позиции отличается',
  'Closed trade missing': 'Отсутствует закрытая сделка',
  'Duplicate closed trade link': 'Повторная ссылка на закрытую сделку',
  'Closed trade ticker differs': 'Тикер закрытой сделки отличается',
  'Closed trade quantity differs': 'Количество закрытой сделки отличается',
  'Closed trade cost basis differs': 'Себестоимость закрытой сделки отличается',
  'Closed trade sale price differs': 'Цена продажи в закрытой сделке отличается',
  'Closed trade gross profit differs': 'Валовая прибыль закрытой сделки отличается',
  'Closed trade commissions differ': 'Комиссии закрытой сделки отличаются',
  'Closed trade financing differs': 'Расходы на финансирование закрытой сделки отличаются',
  'Closed trade net profit differs': 'Чистая прибыль закрытой сделки отличается',
  'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics; removed cost basis is not treated as a sale.': 'Удаление денежного актива является корректировкой учёта без выручки от продажи и реализованной прибыли/убытка; удалённая себестоимость не считается продажей.',
  'Buy event does not contain a stable lot ID, ticker, exact acquisition date, positive quantity, acquisition price and matching quantity delta.': 'Событие покупки не содержит стабильный ID лота, тикер, точную дату приобретения, положительное количество, цену покупки и соответствующее изменение количества.',
  'A stable acquisition lot ID is reused by more than one buy event.': 'Стабильный ID лота приобретения повторно используется в нескольких событиях покупки.',
  'Buy event predates exact acquisition-date capture; source date was not inferred from the event timestamp.': 'Для события покупки не сохранена точная дата приобретения; дата не выводилась из временной метки события.',
  'Buy event does not contain a verifiable non-negative commission amount.': 'Событие покупки не содержит проверяемую неотрицательную сумму комиссии.',
  'Sale event has no exact FIFO lot allocations; no acquisition lot was inferred.': 'Событие продажи не содержит точного распределения лотов по FIFO; лоты приобретения не выводились предположительно.',
  'Sale contains legacy-unmapped acquisition slices; those slices remain unlinked and are not reconstructed.': 'Продажа содержит не сопоставленные с лотами фрагменты старой истории; они остаются несвязанными и не восстанавливаются.',
  'Sale references a stable lot ID that is absent from the available buy-event history.': 'Продажа ссылается на стабильный ID лота, отсутствующий в доступной истории покупок.',
  'Sale allocation conflicts with the referenced acquisition lot identity, price, date or remaining quantity.': 'Распределение продажи противоречит идентификатору, цене, дате или оставшемуся количеству указанного лота приобретения.',
  'Sale allocation consumes more buy commission than remains on the referenced lot.': 'Распределение продажи использует комиссию покупки сверх остатка по указанному лоту.',
  'Sale allocations do not consume the known open acquisition lots in FIFO order.': 'Распределение продажи не использует известные открытые лоты приобретения в порядке FIFO.',
  'Stable lot sale allocations do not agree with the sale event price and gross proceeds.': 'Распределение продажи по стабильным лотам не соответствует цене события продажи и валовой выручке.',
  'Corporate-action lot conversion does not include every open app-owned lot for the affected ticker.': 'Преобразование лотов в рамках корпоративного действия не включает все открытые лоты приложения для затронутого тикера.',
  'Corporate-action lot conversion conflicts with the recorded lot identity, remaining quantity, price, acquisition date or commission.': 'Преобразование лотов в рамках корпоративного действия противоречит записанному идентификатору лота, оставшемуся количеству, цене, дате приобретения или комиссии.',
  'Position quantity changed without an exact acquisition-lot adjustment; lot identity was not inferred.': 'Количество позиции изменилось без точной корректировки лотов приобретения; идентификаторы лотов не выводились предположительно.',
  'Cash-holding quantity changed without exact acquisition-lot or disposal allocations; cost basis was not inferred.': 'Количество денежного актива изменилось без точного распределения лотов приобретения или выбытия; себестоимость не выводилась предположительно.',
  'Trade or cash-holding lot quantity corrections are not supported by the current reversal contract.': 'Корректировки количества торговых или денежных лотов не поддерживаются текущим контрактом отмены.',
  'Closed-history correction has no linked lot-level correction projection.': 'Корректировка истории закрытых сделок не имеет связанного проецируемого изменения на уровне лотов.',
  'A closed-trade replay item is missing required financial data.': 'Для воспроизведения закрытой сделки не хватает необходимых финансовых данных.',
  'Stable sale event has no linked canonical closed-trade record.': 'Для стабильного события продажи отсутствует связанная каноническая запись закрытой сделки.'
};

const LOT_PARITY_DISCREPANCY_LABELS: Record<PortfolioLotParityResult['discrepancies'][number]['field'], string> = {
  'open-lot-missing': 'Open lot missing',
  'open-lot-quantity': 'Open lot quantity differs',
  'open-lot-cost': 'Open lot cost basis differs',
  'open-lot-acquisition-date': 'Open lot acquisition date differs',
  'open-lot-buy-commission': 'Open lot buy commission differs',
  'cash-holding-lot-missing': 'Cash-holding lot missing',
  'cash-holding-lot-quantity': 'Cash-holding lot quantity differs',
  'cash-holding-lot-cost': 'Cash-holding lot cost basis differs',
  'cash-holding-lot-acquisition-date': 'Cash-holding lot acquisition date differs',
  'cash-holding-lot-buy-commission': 'Cash-holding lot buy commission differs',
  'position-lot-quantity': 'Position lot quantity differs',
  'position-buy-commission': 'Position buy commission differs',
  'closed-trade-missing': 'Closed trade missing',
  'closed-trade-duplicate': 'Duplicate closed trade link',
  'closed-trade-ticker': 'Closed trade ticker differs',
  'closed-trade-quantity': 'Closed trade quantity differs',
  'closed-trade-cost': 'Closed trade cost basis differs',
  'closed-trade-price': 'Closed trade sale price differs',
  'closed-trade-gross-profit': 'Closed trade gross profit differs',
  'closed-trade-commissions': 'Closed trade commissions differ',
  'closed-trade-financing': 'Closed trade financing differs',
  'closed-trade-net-profit': 'Closed trade net profit differs'
};

export function translateBrokerReconciliationCopy(value: string, language = getAppLanguage()): string {
  return language === 'ru' ? RU_COPY[value] || value : value;
}

export function getPortfolioLotParityHeadline(
  status: PortfolioLotParityResult['status'],
  discrepancyCount: number
): string {
  if (status === 'unsupported') return 'Unsupported';
  if (status === 'incomplete') return 'Incomplete';
  return discrepancyCount > 0 ? 'Differences found' : 'Matched within supported history';
}

export function getPortfolioLotParityDiscrepancyLabel(
  field: PortfolioLotParityResult['discrepancies'][number]['field']
): string {
  return LOT_PARITY_DISCREPANCY_LABELS[field];
}

export function translatePortfolioLotParityIssueReason(
  reason: string,
  language = getAppLanguage()
): string {
  if (language !== 'ru') return reason;
  const exact = RU_COPY[reason];
  if (exact) return exact;

  let match = reason.match(/^Canonical (.+) position has no acquisition lots\.$/);
  if (match) return 'В позиции ' + match[1] + ' отсутствуют лоты приобретения.';
  match = reason.match(/^Canonical (.+) contains a legacy lot without stable identity; it was not assigned a synthetic ID\.$/);
  if (match) return 'Позиция ' + match[1] + ' содержит старый лот без стабильного идентификатора; синтетический ID не назначался.';
  match = reason.match(/^Canonical snapshot reuses acquisition lot ID (.+)\.$/);
  if (match) return 'В каноническом снимке повторно используется ID лота приобретения ' + match[1] + '.';
  match = reason.match(/^Canonical (.+) position has a lot whose remaining buy commission cannot be replayed\.$/);
  if (match) return 'Для лота позиции ' + match[1] + ' невозможно воспроизвести оставшуюся комиссию покупки.';
  match = reason.match(/^Canonical lot (.+) cannot be checked against a source acquisition date\.$/);
  if (match) return 'Лот ' + match[1] + ' невозможно проверить по исходной дате приобретения.';
  match = reason.match(/^Canonical lot (.+) does not expose its remaining buy commission\.$/);
  if (match) return 'Для канонического лота ' + match[1] + ' не указана оставшаяся комиссия покупки.';
  match = reason.match(/^Replay cannot verify remaining buy commission for lot (.+)\.$/);
  if (match) return 'Воспроизведение не может проверить оставшуюся комиссию покупки для лота ' + match[1] + '.';
  match = reason.match(/^Canonical cash holding (.+) has no app-recorded acquisition lots; broker average prices were not converted into synthetic lots\.$/);
  if (match) return 'Для денежного актива ' + match[1] + ' нет записанных приложением лотов приобретения; средние цены брокера не преобразовывались в синтетические лоты.';
  match = reason.match(/^Canonical cash holding (.+) contains an invalid or incomplete acquisition lot\.$/);
  if (match) return 'Денежный актив ' + match[1] + ' содержит некорректный или неполный лот приобретения.';
  match = reason.match(/^Canonical portfolio reuses acquisition lot ID (.+)\.$/);
  if (match) return 'В каноническом портфеле повторно используется ID лота приобретения ' + match[1] + '.';
  match = reason.match(/^Canonical cash holding (.+) has (.+) shares but only (.+) shares with app-recorded cost basis; remaining quantity is unmapped\.$/);
  if (match) return 'Для денежного актива ' + match[1] + ' указано ' + match[2] + ' акций, но себестоимость известна только для ' + match[3] + '; оставшееся количество не сопоставлено.';
  match = reason.match(/^Legacy closed trade (.+) has no source sale-event link\.$/);
  if (match) return 'Для старой закрытой сделки ' + match[1] + ' отсутствует ссылка на исходное событие продажи.';
  match = reason.match(/^Closed trade links to sale event (.+), but that event has no complete stable-lot replay projection\.$/);
  if (match) return 'Закрытая сделка ссылается на событие продажи ' + match[1] + ', но для него нет полного воспроизведения по стабильным лотам.';
  match = reason.match(/^Closed trade linked to (.+) has no recorded average entry price\.$/);
  if (match) return 'Для закрытой сделки, связанной с ' + match[1] + ', не записана средняя цена входа.';
  match = reason.match(/^Closed trade linked to (.+) has no recorded sale price\.$/);
  if (match) return 'Для закрытой сделки, связанной с ' + match[1] + ', не записана цена продажи.';
  match = reason.match(/^Closed trade linked to (.+) lacks (.+) data\.$/);
  if (match) {
    const fieldLabels: Record<string, string> = {
      'gross-profit': 'валовой прибыли',
      'commissions': 'комиссий',
      'financing': 'расходов на финансирование',
      'net-profit': 'чистой прибыли'
    };
    return 'Для закрытой сделки, связанной с ' + match[1] + ', отсутствуют данные: ' + (fieldLabels[match[2]] || match[2]) + '.';
  }
  return 'Описание замечания воспроизведения лотов недоступно на русском языке.';
}

export function getBrokerReconciliationHeadline(
  status: 'matched' | 'differences' | 'partial' | 'unavailable',
  findingCount: number
): string {
  if (status === 'unavailable') return 'History unavailable';
  if (status === 'partial') return 'Provisional review';
  return findingCount > 0 ? 'Differences found' : 'Matched';
}

export function getBrokerReconciliationCountLabel(
  status: 'matched' | 'differences' | 'partial' | 'unavailable'
): string {
  return status === 'partial' || status === 'unavailable' ? 'provisional items' : 'findings';
}

export function getBrokerReconciliationEmptyMessage(
  status: 'matched' | 'differences' | 'partial' | 'unavailable'
): string {
  if (status === 'partial') return 'No confirmed differences were found in the available records; incomplete coverage prevents a full match confirmation.';
  if (status === 'unavailable') return 'Broker history is unavailable; no transaction-level comparison could be confirmed.';
  return 'No transaction-level differences were found in the available records.';
}



export function getBrokerQuoteReconciliationHeadline(status: BrokerQuoteReconciliationStatus): string {
  if (status === 'unavailable') return 'Broker quote data unavailable';
  if (status === 'stale') return 'Stale broker quote snapshot';
  if (status === 'partial') return 'Provisional price comparison';
  return status === 'differences' ? 'Price differences found' : 'Prices matched';
}

interface BrokerTransactionReconciliationProps {
  executions: readonly BrokerExecution[];
  cashflows: readonly BrokerCashflow[];
  appEvents: readonly PortfolioTransactionEvent[];
  executionStatus: ReconciliationFeedStatus;
  cashflowStatus: ReconciliationFeedStatus;
  appHistoryStatus?: ReconciliationFeedStatus;
  legacyClosedTrades?: readonly ClosedTrade[];
  /** Optional app-owned quotes and broker snapshot for read-only price comparison. */
  appQuotes?: readonly AppQuoteHolding[];
  /** Passing null explicitly renders an unavailable broker-price state. */
  brokerQuoteSnapshot?: BrokerQuoteSnapshot | null;
  /** Canonical snapshot inputs used only for read-only lot and closed-trade parity. */
  positions: Record<string, Pick<PositionRecord, 'shares' | 'commBuy' | 'tranches'>>;
  cashHoldings: readonly Pick<CashStockHolding, 'ticker' | 'shares' | 'lots'>[];
  /** Records an audit-only note; must not mutate financial data. */
  onRecordReview?: RecordBrokerReconciliationReview;
}

const FINDING_LABELS: Record<string, string> = {
  duplicate_broker_execution: 'Duplicate broker execution',
  execution_revision_conflict: 'Broker execution revision conflict',
  execution_match_ambiguous: 'Ambiguous broker order match',
  execution_unclassified: 'Unclassified broker execution',
  duplicate_broker_cashflow: 'Duplicate broker cashflow',
  cashflow_revision_conflict: 'Broker cashflow revision conflict',
  cashflow_unclassified: 'Unclassified broker cashflow',
  cashflow_direction_mismatch: 'Cashflow direction differs',
  cashflow_match_ambiguous: 'Ambiguous broker cashflow match',
  execution_missing_in_app: 'Execution not found in app journal',
  execution_missing_in_broker: 'App trade not found in broker history',
  execution_quantity_mismatch: 'Execution quantity differs',
  execution_price_mismatch: 'Execution price differs',
  execution_fee_mismatch: 'Commission differs',
  execution_fee_currency_mismatch: 'Commission currency differs',
  execution_timing_difference: 'Execution timestamp differs',
  cashflow_missing_in_app: 'Cashflow not found in app journal',
  cashflow_missing_in_broker: 'App cashflow not found in broker history',
  cashflow_amount_mismatch: 'Cashflow amount differs',
  cashflow_currency_mismatch: 'Cashflow currency differs',
  cashflow_type_mismatch: 'Cashflow classification differs'
};

function formatValue(value: number | null, currency?: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
  return currency ? `${amount} ${currency}` : amount;
}
function formatTimestamp(value?: number): string {
  if (!Number.isFinite(value)) return '—';
  const date = new Date(value as number);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
}

export function BrokerTransactionReconciliation({
  executions, cashflows, appEvents, executionStatus, cashflowStatus,
  appHistoryStatus = 'partial', legacyClosedTrades = [],
  positions, cashHoldings, appQuotes = [], brokerQuoteSnapshot, onRecordReview
}: BrokerTransactionReconciliationProps) {
  const [reviewReasonByKey, setReviewReasonByKey] = useState<Record<string, string>>({});
  const [reviewOpenKey, setReviewOpenKey] = useState<string | null>(null);
  const [reviewErrorByKey, setReviewErrorByKey] = useState<Record<string, string>>({});
  const report = reconcileBrokerActivity({
    brokerExecutions: executions, brokerCashflows: cashflows, appEvents,
    executionStatus, cashflowStatus, appHistoryStatus, legacyClosedTrades
  });
  const label = getBrokerReconciliationHeadline(report.status, report.findings.length);
  const countLabel = getBrokerReconciliationCountLabel(report.status);
  const emptyMessage = getBrokerReconciliationEmptyMessage(report.status);
  const emptyMessageClass = report.status === 'matched' ? 'text-emerald-300' : 'text-slate-400';
  const labelClass = report.status === 'matched' ? 'text-emerald-300' :
    report.status === 'differences' ? 'text-amber-300' : 'text-slate-300';
  const journalCoverage = inspectPortfolioTransactionJournalReplayCoverage(appEvents);
  const lotParity = verifyPortfolioTransactionLotParity(appEvents, {
    positions,
    cashHoldings,
    closedTrades: legacyClosedTrades
  });
  const lotParityHeadline = getPortfolioLotParityHeadline(lotParity.status, lotParity.discrepancies.length);
  const lotParityStatusClass = lotParity.status === 'unsupported'
    ? 'text-rose-300'
    : lotParity.status === 'incomplete' || lotParity.discrepancies.length > 0
      ? 'text-amber-300' : 'text-emerald-300';
  const replayedOpenLotCount = lotParity.replay.openLots.length + lotParity.replay.cashHoldingOpenLots.length;
  const replayedClosedSaleCount = lotParity.replay.sales.length + lotParity.replay.cashHoldingSales.length;
  const journalCoverageStatusLabel = journalCoverage.status === 'complete'
    ? 'Complete within scope'
    : journalCoverage.status === 'unsupported' ? 'Unsupported' : 'Incomplete';
  const journalCoverageStatusClass = journalCoverage.status === 'complete'
    ? 'text-emerald-300'
    : journalCoverage.status === 'unsupported' ? 'text-rose-300' : 'text-amber-300';
  const quoteReport = brokerQuoteSnapshot === undefined ? null : reconcileBrokerQuotePrices({
    brokerSnapshot: brokerQuoteSnapshot,
    appQuotes
  });

  const renderReviewControl = (
    section: BrokerReconciliationReviewSection,
    findingId: string,
    findingType: string,
    subject: string
  ) => {
    const key = getBrokerReconciliationReviewIdempotencyKey(section, findingId);
    const previousReview = findBrokerReconciliationReview(appEvents, section, findingId);
    if (previousReview) {
      return (
        <div class="mt-2 rounded border border-slate-800 bg-slate-950/40 px-2.5 py-2" role="status">
          <strong class="text-emerald-300">{translateBrokerReconciliationCopy('Reviewed · not resolved')}</strong>
          <p class="mt-1 text-slate-500">{translateBrokerReconciliationCopy('This is an audit note only. It does not resolve the finding or change portfolio data.')}</p>
          <p class="mt-1 text-slate-400">{translateBrokerReconciliationCopy('Reviewed note')}: {previousReview.note}</p>
        </div>
      );
    }
    if (!onRecordReview || !key) return null;
    const reason = reviewReasonByKey[key] || '';
    const error = reviewErrorByKey[key] || '';
    const inputId = `reconciliation-review-reason-${section}-${findingId}`;
    const submit = () => {
      const cleanReason = reason.trim();
      if (!cleanReason) {
        setReviewErrorByKey((current) => ({ ...current, [key]: 'Enter a reason to record this review.' }));
        return;
      }
      const saved = onRecordReview(section, findingId, findingType, subject, cleanReason);
      if (saved) {
        setReviewOpenKey(null);
        setReviewReasonByKey((current) => ({ ...current, [key]: '' }));
        setReviewErrorByKey((current) => ({ ...current, [key]: '' }));
      } else {
        setReviewErrorByKey((current) => ({ ...current, [key]: 'Review could not be recorded. No financial data was changed.' }));
      }
    };
    return (
      <div class="mt-2 space-y-2">
        {reviewOpenKey === key ? (
          <div class="space-y-2 rounded border border-slate-800 bg-slate-950/40 p-2">
            <label class="block space-y-1 text-[10px] text-slate-400" for={inputId}>
              <span>{translateBrokerReconciliationCopy('Reason for review')}</span>
              <textarea
                id={inputId}
                rows={2}
                maxLength={240}
                value={reason}
                onInput={(event) => setReviewReasonByKey((current) => ({ ...current, [key]: event.currentTarget.value }))}
                class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              />
            </label>
            <p class="text-[10px] text-slate-500">{translateBrokerReconciliationCopy('This is an audit note only. It does not resolve the finding or change portfolio data.')}</p>
            {error && <p role="alert" class="text-[10px] text-amber-300">{translateBrokerReconciliationCopy(error)}</p>}
            <div class="flex flex-wrap gap-2">
              <button type="button" disabled={!reason.trim()} onClick={submit}
                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-cyan-700/70 px-2.5 py-1.5 text-[10px] font-bold text-cyan-200 hover:bg-cyan-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
                {translateBrokerReconciliationCopy('Record review')}
              </button>
              <button type="button" onClick={() => { setReviewOpenKey(null); setReviewErrorByKey((current) => ({ ...current, [key]: '' })); }}
                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-300">
                {translateBrokerReconciliationCopy('Cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setReviewOpenKey(key)}
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 hover:border-cyan-700 hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
            {translateBrokerReconciliationCopy('Review item')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div class="space-y-3 text-xs">
      <p class="text-slate-400">{translateBrokerReconciliationCopy('Read-only comparison of broker executions and cashflows with app-authored journal events. No portfolio data is changed.')}</p>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <strong class={labelClass}>{translateBrokerReconciliationCopy(label)}</strong>
        <span class={report.status === 'partial' || report.status === 'unavailable' ? 'text-amber-300' : 'text-slate-500'}>{report.findings.length} {translateBrokerReconciliationCopy(countLabel)}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Broker executions')}</div><strong>{report.brokerExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('App journal executions')}</div><strong>{report.appExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched executions')}</div><strong>{report.matchedExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Legacy closed sales')}</div><strong>{report.legacyClosedSaleCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched legacy sales')}</div><strong>{report.matchedLegacyClosedSaleCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched legacy sell fills')}</div><strong>{report.matchedLegacyExecutionCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Broker cashflows')}</div><strong>{report.brokerCashflowCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('App journal cashflows')}</div><strong>{report.appCashflowCount}</strong></div>
        <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Matched cashflows')}</div><strong>{report.matchedCashflowCount}</strong></div>
      </div>
      <section class="space-y-2 rounded border border-slate-800 bg-slate-950/30 p-3" aria-label={translateBrokerReconciliationCopy('App transaction journal coverage')}>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold text-slate-200">{translateBrokerReconciliationCopy('App transaction journal coverage')}</h3>
          <strong class={journalCoverageStatusClass}>{translateBrokerReconciliationCopy(journalCoverageStatusLabel)}</strong>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Replayable events')}</div><strong>{journalCoverage.replayableCount}</strong></div>
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Evidence-only events')}</div><strong>{journalCoverage.evidenceOnlyCount}</strong></div>
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Audit-only events')}</div><strong>{journalCoverage.auditOnlyCount}</strong></div>
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Items needing review')}</div><strong>{journalCoverage.issues.length}</strong></div>
        </div>
        <p class="text-slate-500">{translateBrokerReconciliationCopy('Coverage applies to position quantities, cash-holding quantities, free cash, margin debt and realized margin charges. It does not certify lot cost basis or closed-trade P&L reconstruction.')}</p>
        {journalCoverage.issues.length > 0 ? (
          <ul class="list-disc space-y-1 pl-4 text-amber-200">
            {journalCoverage.issues.slice(0, 5).map((finding, index) => (
              <li key={(finding.eventId || 'journal-finding') + '-' + index}>
                {translateBrokerReconciliationCopy(finding.reason)}
              </li>
            ))}
          </ul>
        ) : (
          <p class="text-emerald-300">{translateBrokerReconciliationCopy('No journal replay issues were detected for the current coverage scope.')}</p>
        )}
        {journalCoverage.issues.length > 5 && <p class="text-slate-500">{translateBrokerReconciliationCopy('Showing first 5 coverage findings')}.</p>}
      </section>
      <section class="mt-3 space-y-2 rounded border border-slate-800 bg-slate-950/30 p-3" aria-label={translateBrokerReconciliationCopy('Lot and closed-trade replay parity')}>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold text-slate-200">{translateBrokerReconciliationCopy('Lot and closed-trade replay parity')}</h3>
          <strong class={lotParityStatusClass}>{translateBrokerReconciliationCopy(lotParityHeadline)}</strong>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Open lots replayed')}</div><strong>{replayedOpenLotCount}</strong></div>
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Closed sales replayed')}</div><strong>{replayedClosedSaleCount}</strong></div>
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Differences')}</div><strong>{lotParity.discrepancies.length}</strong></div>
          <div><div class="text-slate-500">{translateBrokerReconciliationCopy('Items needing review')}</div><strong>{lotParity.issues.length}</strong></div>
        </div>
        <p class="text-slate-500">{translateBrokerReconciliationCopy('Compares app-owned acquisition lots, FIFO sale allocations and linked closed-trade values. Legacy or unmapped history remains incomplete; no portfolio data is changed.')}</p>
        <p class="text-slate-500">{translateBrokerReconciliationCopy('Replay and canonical values are shown only as read-only evidence.')}</p>
        {lotParity.discrepancies.length > 0 && (
          <div class="space-y-1">
            <h4 class="font-semibold text-amber-200">{translateBrokerReconciliationCopy('Differences')}</h4>
            <ul class="list-disc space-y-2 pl-4 text-amber-100">
              {lotParity.discrepancies.slice(0, 5).map((finding, index) => (
                <li key={finding.field + '-' + finding.identity + '-' + index}>
                  <div class="flex flex-wrap gap-x-2 gap-y-1">
                    <strong>{translateBrokerReconciliationCopy(getPortfolioLotParityDiscrepancyLabel(finding.field))}</strong>
                    <span class="font-mono text-slate-400">{translateBrokerReconciliationCopy('Identity')}: {finding.identity}</span>
                  </div>
                  <div class="font-mono text-xs text-slate-400">
                    {translateBrokerReconciliationCopy('Replay')}: {typeof finding.replayed === 'number' ? formatValue(finding.replayed) : finding.replayed}
                    {' · '}{translateBrokerReconciliationCopy('Canonical')}: {typeof finding.canonical === 'number' ? formatValue(finding.canonical) : finding.canonical}
                  </div>
                </li>
              ))}
            </ul>
            {lotParity.discrepancies.length > 5 && <p class="text-slate-500">{translateBrokerReconciliationCopy('Showing first 5 lot replay differences')}.</p>}
          </div>
        )}
        {lotParity.issues.length > 0 ? (
          <div class="space-y-1">
            <h4 class="font-semibold text-amber-200">{translateBrokerReconciliationCopy('Items needing review')}</h4>
            <ul class="list-disc space-y-1 pl-4 text-amber-100">
              {lotParity.issues.slice(0, 5).map((finding, index) => (
                <li key={(finding.eventId || 'lot-parity-issue') + '-' + index}>
                  <span class={finding.disposition === 'unsupported' ? 'text-rose-300' : 'text-amber-300'}>
                    {translateBrokerReconciliationCopy(finding.disposition === 'unsupported' ? 'Unsupported' : 'Incomplete')}
                  </span>
                  {' · '}{finding.eventId && <span class="font-mono text-slate-400">{finding.eventId}: </span>}
                  {translatePortfolioLotParityIssueReason(finding.reason)}
                </li>
              ))}
            </ul>
            {lotParity.issues.length > 5 && <p class="text-slate-500">{translateBrokerReconciliationCopy('Showing first 5 lot replay issues')}.</p>}
          </div>
        ) : lotParity.discrepancies.length === 0 ? (
          <p class="text-emerald-300">{translateBrokerReconciliationCopy('No lot or closed-trade replay differences were detected for the supplied history.')}</p>
        ) : null}
      </section>
      {report.legacyClosedSaleCount > 0 && (
        <p class="text-slate-500">
          {translateBrokerReconciliationCopy('Legacy closed sales are app summaries, not transaction-journal events.')} {translateBrokerReconciliationCopy('Legacy closed-sale summaries are matched only when the broker sell fills agree on ticker, date, total quantity and weighted price. They do not establish historical buy executions or cashflows.')}
        </p>
      )}
      {report.warnings.length > 0 && (
        <ul class="list-disc space-y-1 pl-4 text-amber-200">
          {report.warnings.map(warning => <li key={warning}>{translateBrokerReconciliationCopy(warning)}</li>)}
        </ul>
      )}
      {report.findings.length > 0 ? (
        <div class="space-y-2">
          {report.findings.slice(0, 30).map(finding => (
            <article key={finding.id} class="rounded border border-slate-800 px-2.5 py-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <strong>{translateBrokerReconciliationCopy(FINDING_LABELS[finding.type] || finding.type)} · {finding.subject}</strong>
                <span class={finding.confidence === 'confirmed' ? 'text-emerald-300' : 'text-amber-300'}>
                  {translateBrokerReconciliationCopy(finding.confidence === 'confirmed' ? 'Confirmed' : 'Provisional')}
                </span>
              </div>
              <p class="mt-1 text-slate-400">{translateBrokerReconciliationCopy(finding.explanation)}</p>
              <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-300">
                <span>{translateBrokerReconciliationCopy('Broker')}: {formatValue(finding.brokerValue, finding.currency)}</span>
                <span>{translateBrokerReconciliationCopy('App')}: {formatValue(finding.appValue, finding.currency)}</span>
                {finding.brokerReferences.length > 0 && <span>{translateBrokerReconciliationCopy('Broker ref')}: {finding.brokerReferences.join(', ')}</span>}
                {finding.appEventIds.length > 0 && <span>{translateBrokerReconciliationCopy('App event')}: {finding.appEventIds.join(', ')}</span>}
                {finding.brokerAt !== undefined && <span>{translateBrokerReconciliationCopy('Broker time')}: {formatTimestamp(finding.brokerAt)}</span>}
                {finding.appAt !== undefined && <span>{translateBrokerReconciliationCopy('App time')}: {formatTimestamp(finding.appAt)}</span>}
              </div>
              {renderReviewControl('activity', finding.id, finding.type, finding.subject)}
            </article>
          ))}
          {report.findings.length > 30 && <p class="text-slate-500">{translateBrokerReconciliationCopy('Showing first 30 findings')}.</p>}
        </div>
      ) : <p class={emptyMessageClass}>{translateBrokerReconciliationCopy(emptyMessage)}</p>}

      {quoteReport && (
        <section class="mt-4 space-y-3 border-t border-slate-800 pt-3" aria-label={translateBrokerReconciliationCopy('Broker market prices')}>
          <div class="space-y-1">
            <h3 class="font-semibold text-slate-200">{translateBrokerReconciliationCopy('Broker market prices')}</h3>
            <p class="text-slate-400">{translateBrokerReconciliationCopy('Read-only comparison of app quote observations with broker-reported position prices. No portfolio data is changed.')}</p>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong class={quoteReport.status === 'matched' ? 'text-emerald-300' : quoteReport.status === 'differences' ? 'text-amber-300' : 'text-slate-300'}>
              {translateBrokerReconciliationCopy(getBrokerQuoteReconciliationHeadline(quoteReport.status))}
            </strong>
            <span class="text-slate-500">
              {translateBrokerReconciliationCopy('Compared quote pairs')}: {quoteReport.matchedCount}
            </span>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-400">
            {quoteReport.provider && <span>{translateBrokerReconciliationCopy('Broker quote source')}: {quoteReport.provider}{quoteReport.source ? ' · ' + quoteReport.source : ''}</span>}
            {quoteReport.observedAt && <span>{translateBrokerReconciliationCopy('Broker observation')}: {formatTimestamp(quoteReport.observedAt)}</span>}
            {quoteReport.receivedAt && <span>{translateBrokerReconciliationCopy('Received')}: {formatTimestamp(quoteReport.receivedAt)}</span>}
          </div>
          {quoteReport.warnings.length > 0 && (
            <ul class="list-disc space-y-1 pl-4 text-amber-200">
              {quoteReport.warnings.map(warning => <li key={warning}>{translateBrokerReconciliationCopy(warning)}</li>)}
            </ul>
          )}
          {quoteReport.findings.length > 0 ? (
            <div class="space-y-2">
              {quoteReport.findings.map(finding => {
                const title = finding.type === 'price_mismatch' ? 'Price mismatch'
                  : finding.type === 'currency_mismatch' ? 'Quote currency mismatch'
                    : finding.type === 'ambiguous_app_quote' ? 'Conflicting app quotes'
                      : finding.type === 'ambiguous_broker_quote' ? 'Conflicting broker prices'
                        : 'Unclassified quote';
                return (
                  <article key={finding.id} class="rounded border border-slate-800 px-2.5 py-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <strong>{translateBrokerReconciliationCopy(title)} · {finding.ticker}</strong>
                      <span class={finding.confidence === 'confirmed' ? 'text-emerald-300' : 'text-amber-300'}>
                        {translateBrokerReconciliationCopy(finding.confidence === 'confirmed' ? 'Confirmed' : 'Provisional')}
                      </span>
                    </div>
                    <p class="mt-1 text-slate-400">{translateBrokerReconciliationCopy(finding.explanation)}</p>
                    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-300">
                      <span>{translateBrokerReconciliationCopy('App quote')}: {formatValue(finding.appValue, finding.appCurrency || finding.currency)}</span>
                      <span>{translateBrokerReconciliationCopy('Broker quote')}: {formatValue(finding.brokerValue, finding.brokerCurrency || finding.currency)}</span>
                      {finding.appCurrency && <span>{translateBrokerReconciliationCopy('App currency')}: {finding.appCurrency}</span>}
                      {finding.brokerCurrency && <span>{translateBrokerReconciliationCopy('Broker currency')}: {finding.brokerCurrency}</span>}
                      {finding.appProvider && <span>{translateBrokerReconciliationCopy('App quote source')}: {finding.appProvider}</span>}
                      {finding.brokerProvider && <span>{translateBrokerReconciliationCopy('Broker quote source')}: {finding.brokerProvider}</span>}
                      {finding.appObservedAt && <span>{translateBrokerReconciliationCopy('App observation')}: {formatTimestamp(finding.appObservedAt)}</span>}
                      {finding.appReceivedAt && <span>{translateBrokerReconciliationCopy('App received')}: {formatTimestamp(finding.appReceivedAt)}</span>}
                      {finding.brokerObservedAt && <span>{translateBrokerReconciliationCopy('Broker observation')}: {formatTimestamp(finding.brokerObservedAt)}</span>}
                      {finding.brokerReceivedAt && <span>{translateBrokerReconciliationCopy('Broker received')}: {formatTimestamp(finding.brokerReceivedAt)}</span>}
                    </div>
                    {renderReviewControl('quote', finding.id, finding.type, finding.ticker)}
                  </article>
                );
              })}
            </div>
          ) : quoteReport.status === 'matched' ? (
            <p class="text-emerald-300">{translateBrokerReconciliationCopy('Prices matched')}</p>
          ) : (
            <p class="text-slate-400">{translateBrokerReconciliationCopy(getBrokerQuoteReconciliationHeadline(quoteReport.status))}</p>
          )}
        </section>
      )}
      <p class="border-t border-slate-800 pt-2 text-slate-500">{translateBrokerReconciliationCopy('Unmatched records remain provisional until transaction journal coverage is complete. Resolution and writeback are not available in this read-only review.')}</p>
      {onRecordReview && <p class="text-slate-500">{translateBrokerReconciliationCopy('Record a review note only; corrections and writeback remain unavailable.')}</p>}
    </div>
  );
}
