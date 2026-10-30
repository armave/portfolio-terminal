import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { getAppLanguage, setAppLanguage, subscribeAppLanguage, translateText } from './i18n';

afterEach(() => setAppLanguage('en'));

describe('app localization', () => {
  it('defaults to English', () => {
    expect(getAppLanguage()).toBe('en');
    expect(translateText('Sign out')).toBe('Sign out');
  });

  it('translates known UI copy into Russian and leaves unknown text unchanged', () => {
    expect(translateText('User management', 'ru')).toBe('Управление пользователями');
    expect(translateText('Unknown market symbol', 'ru')).toBe('Unknown market symbol');
  });

  it('translates text and accessible labels when Preact nodes are created', () => {
    setAppLanguage('ru');
    const vnode = h('button', { title: 'Sign out', 'aria-label': 'Sign out' }, 'Sign out');
    expect(vnode.props.children).toBe('Выйти');
    expect(vnode.props.title).toBe('Выйти');
    expect(vnode.props['aria-label']).toBe('Выйти');
  });

  it('translates dynamic accessibility labels, update text, and quantity counters', () => {
    expect(translateText('Updated 4m ago', 'ru')).toBe('Обновлено 4m ago');
    expect(translateText('Read news: Apple announces results', 'ru')).toBe('Читать новость: Apple announces results');
    expect(translateText('Stocktwits unavailable: Network error', 'ru')).toBe('Stocktwits недоступен: Network error');
    expect(translateText('Assigned stock value: ≥$1,200', 'ru')).toBe('Стоимость назначенных акций: ≥$1,200');
    expect(translateText('3 tranches', 'ru')).toBe('3 лота');
    expect(translateText('2 records', 'ru')).toBe('2 записи');
    expect(translateText('Show 4 tranches', 'ru')).toBe('Показать 4 лота');
  });

  it('notifies the app when the selected language changes', () => {
    const changes: string[] = [];
    const unsubscribe = subscribeAppLanguage((language) => changes.push(language));
    setAppLanguage('ru');
    setAppLanguage('en');
    unsubscribe();
    expect(changes).toEqual(['ru', 'en']);
  });
});
