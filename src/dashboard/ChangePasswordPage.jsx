import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock } from 'lucide-react';
import logo from '../assets/ab-securitas-logo.png';

/**
 * Lets a user choose their own passcode. When [forced] (first sign-in on the shared initial
 * passcode) there is no way out except signing out; otherwise [onDone] closes the page.
 */
export const ChangePasswordPage = ({ forced = false, onDone }) => {
  const { changePassword, logout, currentUser } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError('The new passcode and the confirmation do not match. Type the same passcode in both boxes.');
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(current, next);
      setSaved(true);
      if (onDone) setTimeout(onDone, 1200);
    } catch (err) {
      setError(err.message || 'The passcode could not be changed. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const field = (id, label, value, setValue, autoComplete, placeholder) => (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>{label}</label>
      <div className="field-icon">
        <input
          id={id}
          type="password"
          className="form-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
        />
        <Lock size={18} aria-hidden="true" />
      </div>
    </div>
  );

  return (
    <div className="login-page">
      <main className="login-card">
        <div className="login-head">
          <img className="logo-wide" src={logo} alt="AB Securitas (Pvt) Ltd" />
          <h1>{forced ? 'Choose your passcode' : 'Change passcode'}</h1>
          <p>
            {forced
              ? `Welcome, ${currentUser?.name}. You are still on the shared starting passcode, so choose your own before you continue.`
              : `Signed in as ${currentUser?.name}.`}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {field('current', 'Current passcode', current, setCurrent, 'current-password', 'Your current passcode')}
          {field('next', 'New passcode', next, setNext, 'new-password', 'At least 8 characters, with letters and numbers')}
          {field('confirm', 'Confirm new passcode', confirm, setConfirm, 'new-password', 'Type the new passcode again')}

          {error && <div role="alert" style={{ marginBottom: '14px' }}>{error}</div>}
          {saved && <div role="status" style={{ marginBottom: '14px' }}>Passcode changed.</div>}

          <button type="submit" disabled={isSubmitting || saved} className="btn-primary" style={{ width: '100%' }}>
            {isSubmitting ? 'Saving...' : 'Save passcode'}
          </button>

          {forced ? (
            <button type="button" onClick={logout} className="btn-secondary" style={{ width: '100%', marginTop: '10px' }}>Sign out</button>
          ) : (
            <button type="button" onClick={onDone} className="btn-secondary" style={{ width: '100%', marginTop: '10px' }}>Cancel</button>
          )}
        </form>
      </main>
    </div>
  );
};
