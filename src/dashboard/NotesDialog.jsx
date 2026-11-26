import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

const MAX_NOTES = 2000;

/**
 * A required-notes dialog (closing an incident, resolving feedback). It replaces the browser's own
 * prompt box: it matches the app, explains what is needed, keeps what was typed when it is empty, and
 * works with the keyboard (Escape cancels, focus starts in the box) and on a phone.
 */
const NotesDialog = ({ title, subject, label, confirmLabel, onSubmit, onCancel }) => {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const box = useRef(null);
  const titleId = useId();
  const hintId = useId();

  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) {
      setError(`${label} are required.`);
      box.current?.focus();
      return;
    }
    onSubmit(value);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} noValidate>
        <h2 id={titleId}>{title}</h2>
        {subject && <p className="dialog-subject">{subject}</p>}
        <label htmlFor={`${titleId}-notes`}>{label}</label>
        <textarea
          id={`${titleId}-notes`}
          ref={box}
          rows={5}
          maxLength={MAX_NOTES}
          value={text}
          onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
          aria-describedby={hintId}
          aria-invalid={error ? 'true' : 'false'}
        />
        <div id={hintId} className="dialog-hint" role={error ? 'alert' : undefined} data-error={error ? 'true' : undefined}>
          {error || `Required. ${text.length} of ${MAX_NOTES} characters.`}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary">{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
};

/**
 * `const [askForNotes, notesDialog] = useNotesDialog();` Render `{notesDialog}` once, then
 * `const notes = await askForNotes({ title, subject, label, confirmLabel })`.
 * Resolves with the trimmed text, or null when the person cancels.
 */
export const useNotesDialog = () => {
  const [request, setRequest] = useState(null);

  const ask = useCallback((options) => new Promise((resolve) => setRequest({ ...options, resolve })), []);

  const finish = (value) => {
    request.resolve(value);
    setRequest(null);
  };

  const dialog = request
    ? <NotesDialog {...request} onSubmit={(v) => finish(v)} onCancel={() => finish(null)} />
    : null;

  return [ask, dialog];
};
