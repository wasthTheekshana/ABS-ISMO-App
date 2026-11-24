import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { UserRound, Lock, ShieldAlert, Users, MapPin, FileText } from 'lucide-react';
import logo from '../assets/ab-securitas-logo.png';

const POINTS = [
  [ShieldAlert, 'Incident management'],
  [Users, 'Duty and deployment'],
  [MapPin, 'Site operations'],
  [FileText, 'Reports and insights']
];

/** Full-page sign-in for the web app. Field staff use the ISOMS phone app instead. */
export const LoginPage = () => {
  const { login } = useApp();
  const [epf, setEpf] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(epf.trim(), password);
    } catch (err) {
      setError(err.message || 'Check your staff ID and passcode, then try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-hero" aria-hidden="true">
        <div className="logo-chip"><img src={logo} alt="" /></div>
        <div>
          <h2>Integrated Security Operations Management System</h2>
          <ul className="auth-points">
            {POINTS.map(([Icon, label]) => (
              <li key={label}><Icon size={20} />{label}</li>
            ))}
          </ul>
        </div>
        <div style={{ color: 'var(--on-sidebar-muted)', fontSize: '13px' }}>AB Securitas (Pvt) Ltd</div>
      </aside>

      <main className="auth-panel">
        <div className="auth-card">
          <img className="logo-wide" src={logo} alt="AB Securitas (Pvt) Ltd" />
          <h1>Sign in to ISOMS</h1>
          <p className="lead">Access your security operations system.</p>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label" htmlFor="epf">Staff ID (EPF number)</label>
              <div className="field-icon">
                <input
                  id="epf"
                  type="text"
                  className="form-input"
                  value={epf}
                  onChange={(e) => setEpf(e.target.value)}
                  placeholder="For example EPF-1042"
                  autoComplete="username"
                  autoCapitalize="characters"
                  required
                />
                <UserRound size={18} aria-hidden="true" />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Passcode</label>
              <div className="field-icon">
                <input
                  id="password"
                  type="password"
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your passcode"
                  autoComplete="current-password"
                  required
                />
                <Lock size={18} aria-hidden="true" />
              </div>
            </div>

            {error && <div role="alert" style={{ marginBottom: '14px' }}>{error}</div>}

            <button type="submit" disabled={isSubmitting} className="btn-primary" style={{ width: '100%' }}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
            <p style={{ textAlign: 'center', marginTop: '14px', fontSize: '13px', color: 'var(--muted)' }}>
              Forgotten your passcode? Ask your administrator to reset it.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
};
