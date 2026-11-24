import React, { useEffect, useMemo, useState } from 'react';
import { Bell, LogOut, RefreshCw, KeyRound, Sun, Moon, MoonStar, MoreHorizontal, X } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { LoginPage } from './dashboard/LoginPage';
import { ChangePasswordPage } from './dashboard/ChangePasswordPage';
import { ExecutiveDashboard } from './dashboard/ExecutiveDashboard';
import { ClientPortal } from './dashboard/ClientPortal';
import { sectionsFor, defaultSection } from './dashboard/nav';
import { installRegisterLabels } from './utils/registerLabels';
import logo from './assets/ab-securitas-logo.png';

const THEME_KEY = 'isoms-theme';
const THEMES = ['auto', 'light', 'dark'];

const readTheme = () => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEMES.includes(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
};

const roleTitle = (role) => ({
  MD: 'Managing Director', GM: 'General Manager', AGM: 'Assistant General Manager', SM: 'Sector Manager',
  VO: 'Visiting Officer', NVO: 'Night Visiting Officer', CONTROL_ROOM: 'Control Room', CLIENT: 'Client'
}[role] || role);

const initials = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

const MainAppContent = () => {
  const { currentUser, authLoading, logout, dataLoading, dataError, refreshData, incidents } = useApp();
  const [changingPasscode, setChangingPasscode] = useState(false);
  const [section, setSection] = useState(null);
  const [incidentId, setIncidentId] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(readTheme);
  const role = currentUser?.role;

  const nav = useMemo(() => sectionsFor(role), [role]);
  const active = nav.sections.some((s) => s.id === section) ? section : defaultSection(role);

  // Light by default, dark if the person or their device asks. The Control Room board starts dark.
  useEffect(() => {
    const root = document.documentElement;
    const effective = theme === 'auto' ? (active === 'board' ? 'dark' : '') : theme;
    if (effective) root.setAttribute('data-theme', effective);
    else root.removeAttribute('data-theme');
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable: the choice just does not persist */ }
  }, [theme, active]);

  // Lets every register (table) stack into labelled entries on a phone.
  useEffect(() => installRegisterLabels(), []);

  // Close the account menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const openIncidents = useMemo(() => incidents.filter((i) => i.status !== 'Closed').length, [incidents]);

  const go = (id) => {
    setSection(id);
    setIncidentId(null);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  };

  const openIncident = (id) => {
    setSection('incidents');
    setIncidentId(id);
    window.scrollTo({ top: 0 });
  };

  // Restoring a session from a stored token: avoid flashing the login screen.
  if (authLoading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>Loading your session...</div>;
  }

  // The dashboard's role scoping depends on a real, server-verified identity.
  if (!currentUser) return <LoginPage />;

  // First login on the shared initial passcode: a personal one must be chosen before anything else.
  if (currentUser.mustChangePassword) return <ChangePasswordPage forced />;

  if (changingPasscode) return <ChangePasswordPage onDone={() => setChangingPasscode(false)} />;

  // Security guards work from the phone app; the web has nothing for them.
  if (role === 'SECURITY_GUARD') {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-head">
            <img className="logo-wide" src={logo} alt="AB Securitas (Pvt) Ltd" />
            <h1>Use the phone app</h1>
            <p>Guard accounts check in and report incidents from the AB ISOMS app. The web dashboard is for management and clients.</p>
          </div>
          <button onClick={logout} className="btn-secondary" style={{ width: '100%' }}>Sign out</button>
        </div>
      </div>
    );
  }

  const isClient = role === 'CLIENT';
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : MoonStar;
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const themeLabel = { auto: 'Theme: follows your device', light: 'Theme: light', dark: 'Theme: dark' }[theme];

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>

      <div className="layout" style={isClient ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
        {!isClient && (
          <aside className="sidebar">
            <div className="logo-chip"><img src={logo} alt="AB Securitas (Pvt) Ltd" /></div>
            <div className="side-sub">ISOMS Operations</div>
            <nav className="side-nav" aria-label="Sections">
              {nav.sections.map((s) => (
                <button key={s.id} className="side-link" aria-current={active === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
                  <s.icon size={18} aria-hidden="true" />
                  {s.label}
                  {s.id === 'incidents' && openIncidents > 0 && <span className="count" aria-label={`${openIncidents} open`}>{openIncidents}</span>}
                </button>
              ))}
            </nav>
            <div className="side-foot">Integrated Security Operations Management System</div>
          </aside>
        )}

        <div className="main-col">
          <header className="topbar">
            <div className="logo-chip"><img src={logo} alt="AB Securitas (Pvt) Ltd" /></div>
            <div className="top-spacer" />
            <button className="icon-btn" onClick={() => setTheme(nextTheme)} aria-label={`${themeLabel}. Switch to ${nextTheme}`} title={themeLabel}>
              <ThemeIcon size={18} />
            </button>
            {!isClient && (
              <button className="icon-btn" onClick={refreshData} disabled={dataLoading} aria-label="Refresh data" title="Refresh data">
                <RefreshCw size={18} />
              </button>
            )}
            {!isClient && (
              <button className="icon-btn" onClick={() => go('incidents')} aria-label={openIncidents > 0 ? `${openIncidents} open incidents` : 'No open incidents'} title="Open incidents">
                <Bell size={18} />
                {openIncidents > 0 && <span className="dot" />}
              </button>
            )}
            <div className="user-wrap">
              <button className="user-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}>
                <span className="avatar" aria-hidden="true">{initials(currentUser.name)}</span>
                <span className="user-text"><strong>{currentUser.name}</strong><small>{roleTitle(role)}</small></span>
              </button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <button role="menuitem" onClick={() => setChangingPasscode(true)}><KeyRound size={16} aria-hidden="true" />Change passcode</button>
                  <button role="menuitem" onClick={logout}><LogOut size={16} aria-hidden="true" />Sign out</button>
                </div>
              )}
            </div>
          </header>

          {dataError && (
            <div role="alert" style={{ borderRadius: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <span>Live data did not load: {dataError}</span>
              <button onClick={refreshData} className="btn-secondary">Try again</button>
            </div>
          )}

          <main id="main" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {isClient
              ? <ClientPortal />
              : <ExecutiveDashboard section={active} onGo={go} incidentId={incidentId} onOpenIncident={openIncident} onBackToIncidents={() => setIncidentId(null)} />}
          </main>
        </div>
      </div>

      {!isClient && (
        <>
          <nav className="tabbar" aria-label="Main sections">
            {nav.primary.map((s) => (
              <button key={s.id} className="tab" aria-current={active === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
                <s.icon size={22} aria-hidden="true" />
                {s.label}
              </button>
            ))}
            {nav.more.length > 0 && (
              <button className="tab" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
                <MoreHorizontal size={22} aria-hidden="true" />
                More
              </button>
            )}
          </nav>

          {moreOpen && (
            <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
              <div className="sheet" role="dialog" aria-modal="true" aria-label="More sections" onClick={(e) => e.stopPropagation()}>
                <div className="sheet-grip" />
                {nav.more.map((s) => (
                  <button key={s.id} className="item" onClick={() => go(s.id)}>
                    <s.icon size={20} aria-hidden="true" />
                    {s.label}
                  </button>
                ))}
                <button className="item" onClick={() => setMoreOpen(false)}><X size={20} aria-hidden="true" />Close</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainAppContent />
    </AppProvider>
  );
}
