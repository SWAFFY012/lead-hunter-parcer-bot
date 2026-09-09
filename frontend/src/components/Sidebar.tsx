import React from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', icon: '📊', label: 'Главная', end: true },
  { to: '/accounts', icon: '📱', label: 'Аккаунты' },
  { to: '/warmup', icon: '🔥', label: 'Прогрев' },
  { to: '/parser', icon: '🕷️', label: 'Автопарсинг' },
  { to: '/manual-bases', icon: '🎯', label: 'Ручные базы' },
  { to: '/profiles', icon: '🧬', label: 'Профили' },
  { to: '/leads', icon: '👥', label: 'Лиды / CRM' },
  { to: '/tasks', icon: '🗓️', label: 'Задачи' },
  { to: '/pipeline', icon: '🗂️', label: 'Воронка' },
  { to: '/ai', icon: '🤖', label: 'Промпты и шаблоны' },
  { to: '/sender', icon: '📤', label: 'Рассылка' },
  { to: '/settings', icon: '⚙️', label: 'Настройки' },
  { to: '/logs', icon: '📝', label: 'Журнал ошибок' },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span style={{ fontSize: '24px' }}>🎯</span>
        <span>LeadHunter</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span style={{ fontSize: '18px' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div style={{ marginTop: 'auto', padding: '24px', borderTop: '1px solid var(--color-border-weak)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }} className="mono">
        v1.0.0-rc1
      </div>
    </aside>
  );
}
