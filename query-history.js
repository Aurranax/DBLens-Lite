(() => {
  'use strict';

  const STORAGE_KEY = 'dblens-query-history-v1';
  const MAX_ENTRIES = 100;

  let history = [];

  function loadHistory() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || '[]'
      );

      history = Array.isArray(saved)
        ? saved.filter(entry =>
            entry &&
            typeof entry.query === 'string' &&
            typeof entry.timestamp === 'string'
          ).slice(0, MAX_ENTRIES)
        : [];

    } catch (error) {
      console.error('Could not load query history:', error);
      history = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(history)
      );
    } catch (error) {
      console.error('Could not save query history:', error);
    }
  }

  function record(entry) {
    const item = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      query: entry.query,
      database: entry.database || 'Unknown database',
      timestamp: entry.timestamp,
      duration: Number(entry.duration) || 0,
      success: Boolean(entry.success),
      error: entry.error || ''
    };

    history.unshift(item);

    if (history.length > MAX_ENTRIES) {
      history = history.slice(0, MAX_ENTRIES);
    }

    saveHistory();
    updateCount();

    const panel = document.getElementById('query-history-panel');

    if (panel && !panel.hidden) {
      renderHistory();
    }
  }

  function initialize() {
    const toggle = document.getElementById('query-history-toggle');
    const close = document.getElementById('query-history-close');
    const clear = document.getElementById('query-history-clear');
    const panel = document.getElementById('query-history-panel');

    if (!toggle || !close || !clear || !panel) {
      console.error('Query History: required HTML elements not found.');
      return;
    }

    loadHistory();
    updateCount();

    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));

      if (!panel.hidden) {
        renderHistory();
      }
    });

    close.addEventListener('click', () => {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });

    clear.addEventListener('click', () => {
      if (!history.length) return;

      const confirmed = window.confirm(
        'Clear all saved query history?'
      );

      if (!confirmed) return;

      history = [];
      saveHistory();
      renderHistory();
      updateCount();
    });

    renderHistory();
  }

  function updateCount() {
    const count = document.getElementById('query-history-count');

    if (count) {
      count.textContent = String(history.length);
    }
  }

  function renderHistory() {
    const container = document.getElementById('query-history-list');

    if (!container) return;

    container.replaceChildren();

    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent =
        'No queries recorded yet. Executed SQL queries will appear here.';

      container.appendChild(empty);
      return;
    }

    history.forEach(entry => {
      container.appendChild(createHistoryItem(entry));
    });
  }

  function createHistoryItem(entry) {
    const card = document.createElement('article');
    card.className = 'history-item';

    const top = document.createElement('div');
    top.className = 'history-item-top';

    const status = document.createElement('span');
    status.className = entry.success
      ? 'history-status history-success'
      : 'history-status history-failed';

    status.textContent = entry.success ? 'SUCCESS' : 'FAILED';

    const timestamp = document.createElement('span');
    timestamp.className = 'history-timestamp';

    const date = new Date(entry.timestamp);

    timestamp.textContent = Number.isNaN(date.getTime())
      ? 'Unknown time'
      : date.toLocaleString();

    top.append(status, timestamp);

    const query = document.createElement('pre');
    query.className = 'history-query';
    query.textContent = entry.query;

    const details = document.createElement('div');
    details.className = 'history-details';

    const database = document.createElement('span');
    database.textContent = entry.database;

    const duration = document.createElement('span');
    duration.textContent = `${entry.duration.toFixed(2)} ms`;

    details.append(database, duration);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'button button-quiet';
    restore.innerHTML = '<i class="fa-solid fa-pen"></i> Restore';

    restore.addEventListener('click', () => {
      if (typeof editor === 'undefined' || !editor) return;

      editor.setValue(entry.query);
      editor.focus();

      const editorPanel = document.querySelector('.editor-panel');

      if (editorPanel) {
        editorPanel.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    });

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'button button-quiet';
    run.innerHTML = '<i class="fa-solid fa-play"></i> Run';

    run.disabled = typeof db === 'undefined' || !db;

    run.addEventListener('click', () => {
      if (typeof db === 'undefined' || !db) return;
      if (typeof runQuery === 'function') {
        runQuery(entry.query);
      }
    });

    actions.append(restore, run);

    card.append(top, query, details, actions);

    if (entry.error) {
      const error = document.createElement('div');
      error.className = 'history-error';
      error.textContent = entry.error;
      card.appendChild(error);
    }

    return card;
  }

  document.addEventListener('DOMContentLoaded', initialize);

  window.DBLensQueryHistory = {
    record
  };
})();