import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { listUsers, type AuthUser } from '../services/api';
import {
  createTenantDirectory,
  getTenantDirectory,
  grantTenantMembership,
  revokeTenantMembership,
  type TenantDirectoryResponse,
  type TenantDirectoryTenantView
} from '../services/tenantDirectoryApi';
import { getAppLanguage } from '../services/i18n';

interface TenantDirectoryPanelProps {
  currentUser: AuthUser | null;
}

const COPY: Record<string, string> = {
  'Portfolio ownership': 'Владение портфелями',
  'Manage tenant and portfolio access metadata.': 'Управление метаданными организаций и доступом к портфелям.',
  'Directory only — financial storage is not enabled for newly created tenants.': 'Только каталог — финансовое хранилище для новых организаций пока не включено.',
  'Tenant metadata created. Financial portfolio storage remains disabled.': 'Метаданные организации созданы. Финансовое хранилище портфеля пока отключено.',
  'Member access updated. Financial portfolio operations are not enabled.': 'Доступ участника обновлён. Финансовые операции с портфелем пока не включены.',
  'Member access revoked.': 'Доступ участника отозван.',
  'Refresh': 'Обновить',
  'Loading tenant directory…': 'Загрузка каталога организаций…',
  'Could not load tenant directory.': 'Не удалось загрузить каталог организаций.',
  'No tenant memberships are available for this account.': 'Для этой учётной записи нет доступных организаций.',
  'Workspace': 'Рабочее пространство',
  'Portfolios': 'Портфели',
  'Owner': 'Владелец',
  'Admin': 'Администратор',
  'Manager': 'Управляющий',
  'Investor': 'Инвестор',
  'Guest': 'Гость',
  'Projection only': 'Только просмотр проекции',
  'Active': 'Активно',
  'Revoked': 'Отозвано',
  'Create tenant metadata': 'Создать организацию',
  'Tenant name': 'Название организации',
  'Workspace name': 'Название рабочего пространства',
  'Portfolio name': 'Название портфеля',
  'Create directory entry': 'Создать запись каталога',
  'Creating…': 'Создание…',
  'Manage members': 'Управление участниками',
  'Member': 'Участник',
  'Access role': 'Роль доступа',
  'Select member': 'Выберите участника',
  'Select portfolio': 'Выберите портфель',
  'Grant access': 'Предоставить доступ',
  'Saving…': 'Сохранение…',
  'Revoke': 'Отозвать',
  'No members yet.': 'Участников пока нет.',
  'Select one portfolio for guest access.': 'Для гостевого доступа выберите один портфель.',
  'Guests receive projection-only access.': 'Гости получают доступ только к проекции.',
  'Financial portfolio operations are not available in this stage.': 'Финансовые операции с портфелями на этом этапе недоступны.',
  'Directory data only. Existing administrator and guest financial data continue to use the legacy shared workspace.': 'Только данные каталога. Существующие финансовые данные администраторов и гостей продолжают использовать прежнее общее рабочее пространство.',
  'A tenant directory request failed.': 'Ошибка запроса к каталогу организаций.',
  'Choose a tenant': 'Выберите организацию'
};

function label(value: string): string {
  return getAppLanguage() === 'ru' ? COPY[value] || value : value;
}

function TenantCard({
  tenant,
  users,
  currentUserId,
  onRevoke,
  revokingUserId
}: {
  tenant: TenantDirectoryTenantView;
  users: AuthUser[];
  currentUserId: string;
  onRevoke: (userId: string) => void;
  revokingUserId: string;
}) {
  const members = tenant.memberships || [];
  const userName = (id: string) => users.find((user) => user.id === id)?.name || id;

  return (
    <article class="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <h4 class="text-sm font-bold text-slate-100">{tenant.tenant.name}</h4>
          <p class="text-[10px] text-slate-500">{tenant.tenant.id}</p>
        </div>
        <span class="rounded-full border border-cyan-900 bg-cyan-950/30 px-2 py-1 text-[10px] text-cyan-300">
          {label(tenant.membership.role.charAt(0).toUpperCase() + tenant.membership.role.slice(1))}
        </span>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded bg-slate-950/60 p-2">
          <div class="text-[10px] uppercase tracking-wide text-slate-500">{label('Workspace')}</div>
          <div class="mt-1 text-xs text-slate-200">{(tenant.workspaces || []).map((item) => item.name).join(', ') || '—'}</div>
        </div>
        <div class="rounded bg-slate-950/60 p-2">
          <div class="text-[10px] uppercase tracking-wide text-slate-500">{label('Portfolios')}</div>
          <div class="mt-1 space-y-1">
            {(tenant.portfolios || []).map((portfolio) => (
              <div key={portfolio.id} class="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-200">
                <span>{portfolio.name}</span>
                {(portfolio.access === 'projection' || portfolio.capabilities.includes('portfolio.projection.read')) && (
                  <span class="text-[10px] text-amber-200">{label('Projection only')}</span>
                )}
              </div>
            ))}
            {(tenant.portfolios || []).length === 0 && <span class="text-xs text-slate-500">—</span>}
          </div>
        </div>
      </div>

      {tenant.memberships && (
        <div class="border-t border-slate-800 pt-2">
          <h5 class="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">{label('Manage members')}</h5>
          {members.length === 0 ? (
            <p class="text-xs text-slate-500">{label('No members yet.')}</p>
          ) : (
            <div class="space-y-1">
              {members.map((member) => (
                <div key={member.userId} class="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-950/50 px-2 py-1.5">
                  <div class="min-w-0">
                    <div class="truncate text-xs text-slate-200">{userName(member.userId)}</div>
                    <div class="text-[10px] text-slate-500">
                      {label(member.role.charAt(0).toUpperCase() + member.role.slice(1))} · {label(member.status.charAt(0).toUpperCase() + member.status.slice(1))}
                    </div>
                  </div>
                  {member.status === 'active' && member.role !== 'owner' && member.userId !== currentUserId && (
                    <button
                      type="button"
                      disabled={revokingUserId === member.userId}
                      onClick={() => onRevoke(member.userId)}
                      class="rounded border border-rose-900/70 px-2 py-1 text-[10px] text-rose-300 disabled:opacity-50"
                    >
                      {revokingUserId === member.userId ? label('Saving…') : label('Revoke')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function TenantDirectoryPanel({ currentUser }: TenantDirectoryPanelProps) {
  const [directory, setDirectory] = useState<TenantDirectoryResponse | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [portfolioName, setPortfolioName] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'manager' | 'investor' | 'guest'>('investor');
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>([]);
  const [revokingUserId, setRevokingUserId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await getTenantDirectory();
      setDirectory(payload);
      setSelectedTenantId((current) =>
        payload.tenants.some((tenant) => tenant.tenant.id === current)
          ? current
          : payload.tenants.find((tenant) => tenant.membership.role === 'owner')?.tenant.id ||
            payload.tenants[0]?.tenant.id || ''
      );
      if (currentUser?.role === 'admin') {
        const entries = await listUsers().catch(() => []);
        setUsers(entries);
      } else {
        setUsers([]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : label('Could not load tenant directory.'));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => { void refresh(); }, [refresh]);

  const manageableTenants = useMemo(
    () => (directory?.tenants || []).filter((tenant) => tenant.membership.role === 'owner'),
    [directory]
  );
  const selectedTenant = manageableTenants.find((tenant) => tenant.tenant.id === selectedTenantId) || manageableTenants[0];
  const isAdmin = currentUser?.role === 'admin';

  const handleCreate = async (event: Event) => {
    event.preventDefault();
    if (!tenantName.trim()) return;
    setWorking(true);
    setError('');
    setSuccess('');
    try {
      await createTenantDirectory({
        name: tenantName.trim(),
        ...(workspaceName.trim() ? { workspaceName: workspaceName.trim() } : {}),
        ...(portfolioName.trim() ? { portfolioName: portfolioName.trim() } : {})
      });
      setTenantName('');
      setWorkspaceName('');
      setPortfolioName('');
      setSuccess('Tenant metadata created. Financial portfolio storage remains disabled.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : label('A tenant directory request failed.'));
    } finally {
      setWorking(false);
    }
  };

  const handleGrant = async (event: Event) => {
    event.preventDefault();
    if (!selectedTenant || !selectedUserId || !selectedPortfolioIds.length) return;
    setWorking(true);
    setError('');
    setSuccess('');
    try {
      await grantTenantMembership({
        tenantId: selectedTenant.tenant.id,
        userId: selectedUserId,
        role: selectedRole,
        portfolioIds: selectedPortfolioIds
      });
      setSelectedUserId('');
      setSelectedPortfolioIds([]);
      setSuccess('Member access updated. Financial portfolio operations are not enabled.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : label('A tenant directory request failed.'));
    } finally {
      setWorking(false);
    }
  };

  const handleRevoke = async (tenantId: string, userId: string) => {
    setRevokingUserId(userId);
    setError('');
    setSuccess('');
    try {
      await revokeTenantMembership({ tenantId, userId });
      setSuccess('Member access revoked.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : label('A tenant directory request failed.'));
    } finally {
      setRevokingUserId('');
    }
  };

  const togglePortfolio = (portfolioId: string, checked: boolean) => {
    setSelectedPortfolioIds((current) => {
      if (!checked) return current.filter((id) => id !== portfolioId);
      if (selectedRole === 'guest') return [portfolioId];
      return current.includes(portfolioId) ? current : [...current, portfolioId];
    });
  };

  return (
    <section class="settings-panel space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" aria-labelledby="tenantDirectoryTitle">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="tenantDirectoryTitle" class="text-sm font-bold text-slate-200">{label('Portfolio ownership')}</h3>
          <p class="text-[10px] text-slate-500">{label('Manage tenant and portfolio access metadata.')}</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || working} class="rounded border border-slate-700 px-2 py-1 text-[10px] font-bold text-cyan-300 disabled:opacity-50">
          {label('Refresh')}
        </button>
      </div>

      <p class="rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[10px] leading-4 text-amber-200">
        {label('Directory only — financial storage is not enabled for newly created tenants.')}
        {directory && directory.financialDataEnabled === false && (
          <span class="ml-1">{label('Financial portfolio operations are not available in this stage.')}</span>
        )}
      </p>

      {loading && <p role="status" class="text-xs text-slate-400">{label('Loading tenant directory…')}</p>}
      {!loading && !error && directory?.tenants.length === 0 && (
        <p class="text-xs text-slate-400">{label('No tenant memberships are available for this account.')}</p>
      )}

      {(directory?.tenants || []).map((tenant) => (
        <TenantCard
          key={tenant.tenant.id}
          tenant={tenant}
          users={users}
          currentUserId={currentUser?.id || ''}
          revokingUserId={revokingUserId}
          onRevoke={(userId) => void handleRevoke(tenant.tenant.id, userId)}
        />
      ))}

      {isAdmin && (
        <details class="border-t border-slate-800 pt-3">
          <summary class="cursor-pointer text-xs font-bold text-cyan-300">{label('Create tenant metadata')}</summary>
          <form onSubmit={handleCreate} class="mt-3 grid gap-2 sm:grid-cols-3">
            <label class="flex flex-col gap-1 text-[10px] text-slate-400">
              {label('Tenant name')}
              <input required minLength={2} maxLength={80} value={tenantName} onInput={(event) => setTenantName((event.target as HTMLInputElement).value)} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"/>
            </label>
            <label class="flex flex-col gap-1 text-[10px] text-slate-400">
              {label('Workspace name')}
              <input maxLength={80} value={workspaceName} onInput={(event) => setWorkspaceName((event.target as HTMLInputElement).value)} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"/>
            </label>
            <label class="flex flex-col gap-1 text-[10px] text-slate-400">
              {label('Portfolio name')}
              <input maxLength={80} value={portfolioName} onInput={(event) => setPortfolioName((event.target as HTMLInputElement).value)} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"/>
            </label>
            <div class="sm:col-span-3">
              <button type="submit" disabled={working || !tenantName.trim()} class="rounded border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-xs font-bold text-cyan-200 disabled:opacity-50">
                {working ? label('Creating…') : label('Create directory entry')}
              </button>
            </div>
          </form>
        </details>
      )}

      {selectedTenant && users.length > 0 && (
        <details class="border-t border-slate-800 pt-3">
          <summary class="cursor-pointer text-xs font-bold text-cyan-300">{label('Grant access')}</summary>
          <form onSubmit={handleGrant} class="mt-3 space-y-3">
            <div class="grid gap-2 sm:grid-cols-3">
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                {label('Choose a tenant')}
                <select value={selectedTenant.tenant.id} onChange={(event) => { setSelectedTenantId((event.target as HTMLSelectElement).value); setSelectedPortfolioIds([]); }} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white">
                  {manageableTenants.map((tenant) => <option key={tenant.tenant.id} value={tenant.tenant.id}>{tenant.tenant.name}</option>)}
                </select>
              </label>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                {label('Member')}
                <select value={selectedUserId} onChange={(event) => setSelectedUserId((event.target as HTMLSelectElement).value)} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white">
                  <option value="">{label('Select member')}</option>
                  {users.filter((user) => user.id !== currentUser?.id).map((user) => <option key={user.id} value={user.id}>{user.name} · {label(user.role.charAt(0).toUpperCase() + user.role.slice(1))}</option>)}
                </select>
              </label>
              <label class="flex flex-col gap-1 text-[10px] text-slate-400">
                {label('Access role')}
                <select value={selectedRole} onChange={(event) => { setSelectedRole((event.target as HTMLSelectElement).value as typeof selectedRole); setSelectedPortfolioIds([]); }} class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white">
                  <option value="manager">{label('Manager')}</option>
                  <option value="investor">{label('Investor')}</option>
                  <option value="guest">{label('Guest')}</option>
                </select>
              </label>
            </div>
            <div class="space-y-1">
              <p class="text-[10px] text-slate-400">{label('Select portfolio')}</p>
              {selectedTenant.portfolios.map((portfolio) => (
                <label key={portfolio.id} class="flex items-center gap-2 rounded bg-slate-900/70 px-2 py-1.5 text-xs text-slate-300">
                  <input type="checkbox" checked={selectedPortfolioIds.includes(portfolio.id)} onChange={(event) => togglePortfolio(portfolio.id, (event.target as HTMLInputElement).checked)}/>
                  {portfolio.name}
                </label>
              ))}
              {selectedRole === 'guest' && <p class="text-[10px] text-amber-200">{label('Select one portfolio for guest access.')}</p>}
            </div>
            {selectedRole === 'guest' && <p class="text-[10px] text-slate-500">{label('Guests receive projection-only access.')}</p>}
            <button type="submit" disabled={working || !selectedUserId || selectedPortfolioIds.length === 0} class="rounded border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-xs font-bold text-cyan-200 disabled:opacity-50">
              {working ? label('Saving…') : label('Grant access')}
            </button>
          </form>
        </details>
      )}

      {error && <p role="alert" class="text-xs text-rose-300">{error}</p>}
      {success && <p role="status" class="text-xs text-emerald-300">{label(success)}</p>}

      <p class="border-t border-slate-800 pt-2 text-[10px] leading-4 text-slate-500">
        {label('Directory data only. Existing administrator and guest financial data continue to use the legacy shared workspace.')}
        {' '}{label('Financial portfolio operations are not available in this stage.')}
      </p>
    </section>
  );
}
