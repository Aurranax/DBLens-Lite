/* DBLens 0.1 — browser-based SQLite explorer
 * SQL.js executes the database in this browser. No database file is uploaded.
 */
'use strict';

let db = null;
let editor = null;
let currentFileName = '';
let lastResult = null;
let lastQuery = '';

const $ = (id) => document.getElementById(id);
const dbFileInput = $('dbFile');
const messageElem = $('message');
const executeQueryBtn = $('execute-query');
const explainQueryBtn = $('explain-query');
const resultsElem = $('results');
const queryStatusElem = $('query-status');
const tableListElem = $('table-list');
const viewListElem = $('view-list');
const indexListElem = $('index-list');

document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
  editor = CodeMirror($('sqlQueryContainer'), {
    mode: 'text/x-sql',
    lineNumbers: true,
    theme: 'material-darker',
    lineWrapping: true,
    tabSize: 2,
    indentWithTabs: false,
    autofocus: false,
    value: '-- Open a database, then write a query here.\nSELECT name, type\nFROM sqlite_master\nWHERE type IN (\'table\', \'view\')\nORDER BY type, name;'
  });
  editor.setSize('100%', 220);

  dbFileInput.addEventListener('change', handleFileSelect);
  executeQueryBtn.addEventListener('click', () => runQuery());
  explainQueryBtn.addEventListener('click', explainQuery);
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('refresh-schema').addEventListener('click', refreshSchema);
  $('export-csv').addEventListener('click', () => exportResults('csv'));
  $('export-json').addEventListener('click', () => exportResults('json'));
  $('load-sample').addEventListener('click', insertDemoQuery);

  editor.on('keydown', (instance, event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runQuery();
    }
  });

  const savedTheme = localStorage.getItem('dblens-theme');
  if (savedTheme === 'light') document.body.classList.add('light-mode');
  updateThemeButton();
  setEditorEnabled(false);
}

async function handleFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (file.size > 150 * 1024 * 1024) {
    showMessage('This preview is intended for database files under 150 MB.', 'error');
    dbFileInput.value = '';
    return;
  }

  showMessage(`Loading ${file.name}…`, 'info');
  try {
    const SQL = await initSqlJs({ locateFile: () => 'sql-wasm.wasm' });
    const buffer = await file.arrayBuffer();
    const nextDb = new SQL.Database(new Uint8Array(buffer));

    if (db) db.close();
    db = nextDb;
    currentFileName = file.name;
    lastResult = null;
    $('database-name').textContent = file.name;
    $('database-size').textContent = formatBytes(file.size);
    $('connection-label').textContent = file.name;
    $('connection-dot').classList.add('connected');
    $('database-status').classList.add('connected');
    setEditorEnabled(true);
    refreshSchema();
    showMessage(`${file.name} loaded successfully. Processing is local to this browser.`, 'success');
    editor.setValue('SELECT name, type\nFROM sqlite_master\nWHERE type IN (\'table\', \'view\')\nORDER BY type, name;');
    editor.focus();
    runQuery();
  } catch (error) {
    db = null;
    setEditorEnabled(false);
    showMessage(`Could not open this database: ${error.message}`, 'error');
    console.error(error);
  } finally {
    dbFileInput.value = '';
  }
}

function setEditorEnabled(enabled) {
  editor.setOption('readOnly', !enabled);
  executeQueryBtn.disabled = !enabled;
  explainQueryBtn.disabled = !enabled;
  $('editor-hint').textContent = enabled ? 'Ctrl + Enter to run' : 'Open a database to enable the editor';
}

function refreshSchema() {
  if (!db) return;
  try {
    const objects = db.exec(`
      SELECT name, type
      FROM sqlite_master
      WHERE type IN ('table', 'view', 'index')
        AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name;
    `)[0];
    const groups = { table: [], view: [], index: [] };
    if (objects) {
      objects.values.forEach(([name, type]) => {
        if (groups[type]) groups[type].push(name);
      });
    }

    renderObjectList(tableListElem, groups.table, 'table');
    renderObjectList(viewListElem, groups.view, 'view');
    renderObjectList(indexListElem, groups.index, 'index');
    $('table-count').textContent = groups.table.length;
    $('view-count').textContent = groups.view.length;
    $('index-count').textContent = groups.index.length;
    $('stat-tables').textContent = groups.table.length;
    $('stat-views').textContent = groups.view.length;
    $('stat-indexes').textContent = groups.index.length;
  } catch (error) {
    showMessage(`Could not refresh schema: ${error.message}`, 'error');
  }
}

function renderObjectList(list, names, type) {
  list.replaceChildren();
  if (!names.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-tree';
    empty.textContent = 'No objects';
    list.appendChild(empty);
    return;
  }

  names.forEach((name) => {
    const item = document.createElement('li');
    item.className = 'object-item';
    item.title = name;
    const icon = document.createElement('i');
    icon.className = type === 'table' ? 'fa-solid fa-table' : type === 'view' ? 'fa-regular fa-window-maximize' : 'fa-solid fa-list';
    const label = document.createElement('span');
    label.textContent = name;
    item.append(icon, label);
    item.addEventListener('click', () => {
      document.querySelectorAll('.object-item.active').forEach((node) => node.classList.remove('active'));
      item.classList.add('active');
      editor.setValue(`SELECT * FROM ${quoteIdentifier(name)} LIMIT 100;`);
      runQuery();
    });
    list.appendChild(item);
  });
}

function runQuery(queryOverride) {
  if (!db) {
    showMessage('Open a database before executing SQL.', 'error');
    return;
  }
  const query = (queryOverride || editor.getValue()).trim();
  if (!query) {
    showMessage('Enter a SQL query first.', 'error');
    return;
  }

  lastQuery = query;
  const started = performance.now();
  queryStatusElem.textContent = 'Executing…';
  resultsElem.innerHTML = '<div class="loading-state"><span class="spinner"></span>Executing query</div>';
  executeQueryBtn.disabled = true;

  // Yield once so the UI can display the running state before SQL.js executes.
  window.setTimeout(() => {
    try {
      const resultSets = db.exec(query);
      const elapsed = (performance.now() - started).toFixed(2);
      if (!resultSets.length) {
        lastResult = { columns: [], values: [] };
        renderEmptyResult('Statement executed successfully. No rows were returned.');
        queryStatusElem.textContent = `Completed in ${elapsed} ms`;
        setExportEnabled(false);
      } else {
        const first = resultSets[0];
        lastResult = { columns: first.columns, values: first.values };
        renderResults(first.columns, first.values);
        const rowCount = first.values.length;
        queryStatusElem.textContent = `${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'} · ${elapsed} ms`;
        setExportEnabled(true);
      }
      if (/^\s*(CREATE|DROP|ALTER|REINDEX)\b/i.test(query)) refreshSchema();
      showMessage('Query completed.', 'success', true);
    } catch (error) {
      lastResult = null;
      renderError(error.message);
      queryStatusElem.textContent = 'Query failed';
      setExportEnabled(false);
      showMessage(error.message, 'error');
    } finally {
      executeQueryBtn.disabled = false;
    }
  }, 15);
}

function explainQuery() {
  if (!db) return;
  const query = editor.getValue().trim().replace(/;+\s*$/, '');
  if (!query) return;
  if (query.includes(';')) {
    showMessage('Explain plan accepts one SQL statement at a time.', 'error');
    return;
  }
  const explainSql = `EXPLAIN QUERY PLAN ${query};`;
  runQuery(explainSql);
}

function renderResults(columns, values) {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  columns.forEach((column) => {
    const th = document.createElement('th');
    th.textContent = column;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  const tbody = document.createElement('tbody');

  values.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell === null ? 'NULL' : String(cell);
      if (cell === null) td.className = 'null-value';
      td.title = cell === null ? 'NULL' : String(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  wrapper.appendChild(table);
  resultsElem.replaceChildren(wrapper);
}

function renderEmptyResult(message) {
  const state = document.createElement('div');
  state.className = 'empty-state compact';
  const strong = document.createElement('strong');
  strong.textContent = message;
  state.appendChild(strong);
  resultsElem.replaceChildren(state);
}

function renderError(message) {
  const box = document.createElement('div');
  box.className = 'error-state';
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-circle-exclamation';
  const text = document.createElement('span');
  text.textContent = message;
  box.append(icon, text);
  resultsElem.replaceChildren(box);
}

function insertDemoQuery() {
  if (!db) {
    showMessage('Load the demo database first, then use Demo queries.', 'info');
    return;
  }
  editor.setValue(`-- Inspect the query plan for an email lookup\nEXPLAIN QUERY PLAN\nSELECT *\nFROM customers\nWHERE email = 'user00420@example.test';`);
  editor.focus();
}

function exportResults(format) {
  if (!lastResult) return;
  const { columns, values } = lastResult;
  let content;
  let mime;
  let extension;

  if (format === 'json') {
    content = JSON.stringify(values.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]]))), null, 2);
    mime = 'application/json';
    extension = 'json';
  } else {
    const escapeCsv = (value) => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    content = [columns.map(escapeCsv).join(','), ...values.map((row) => row.map(escapeCsv).join(','))].join('\r\n');
    mime = 'text/csv;charset=utf-8';
    extension = 'csv';
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dblens-results.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function setExportEnabled(enabled) {
  $('export-csv').disabled = !enabled;
  $('export-json').disabled = !enabled;
}

function toggleTheme() {
  document.body.classList.toggle('light-mode');
  localStorage.setItem('dblens-theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
  updateThemeButton();
}

function updateThemeButton() {
  const light = document.body.classList.contains('light-mode');
  $('theme-toggle').innerHTML = light ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
}

function showMessage(message, type = 'info', quiet = false) {
  messageElem.textContent = message;
  messageElem.className = `message ${type}${quiet ? ' quiet' : ''}`;
  if (!message) messageElem.className = 'message';
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let i = 1; size >= 1024 && i < units.length; i++) {
    size /= 1024;
    unit = units[i];
  }
  return `${size.toFixed(1)} ${unit}`;
}
