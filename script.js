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
      if (type === 'table') {
        editor.setValue(`SELECT * FROM ${quoteIdentifier(name)} LIMIT 100;`);
        runQuery();
      } else if (type === 'view') {
        editor.setValue(`SELECT * FROM ${quoteIdentifier(name)} LIMIT 100;`);
        runQuery();
      } else {
        inspectIndex(name);
      }
    });
    if (type === 'table') {
      const inspectButton = document.createElement('button');
      inspectButton.type = 'button';
      inspectButton.className = 'object-inspect';
      inspectButton.title = `Inspect ${name} structure`;
      inspectButton.setAttribute('aria-label', `Inspect ${name} structure`);
      inspectButton.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
      inspectButton.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.object-item.active').forEach((node) => node.classList.remove('active'));
        item.classList.add('active');
        inspectTable(name);
      });
      item.appendChild(inspectButton);
    }
    list.appendChild(item);
  });
}


function inspectTable(tableName) {
  if (!db) return;
  try {
    const quoted = quoteIdentifier(tableName);
    const columnResult = db.exec(`PRAGMA table_info(${quoted});`);
    const foreignResult = db.exec(`PRAGMA foreign_key_list(${quoted});`);
    const indexResult = db.exec(`PRAGMA index_list(${quoted});`);
    const columns = columnResult[0] ? columnResult[0].values : [];
    const foreignKeys = foreignResult[0] ? foreignResult[0].values : [];
    const indexes = indexResult[0] ? indexResult[0].values : [];
    renderSchemaInspector(tableName, columns, foreignKeys, indexes);
    $('results-title').textContent = `Structure · ${tableName}`;
    queryStatusElem.textContent = `${columns.length} columns · ${foreignKeys.length} foreign-key entries · ${indexes.length} indexes`;
    setExportEnabled(false);
    showMessage(`Inspecting table: ${tableName}`, 'success', true);
  } catch (error) {
    renderError(`Could not inspect table: ${error.message}`);
    queryStatusElem.textContent = 'Schema inspection failed';
    showMessage(error.message, 'error');
  }
}

function inspectIndex(indexName) {
  if (!db) return;
  try {
    const result = db.exec(`PRAGMA index_info(${quoteIdentifier(indexName)});`);
    const rows = result[0] ? result[0].values : [];
    const wrapper = document.createElement('div');
    wrapper.className = 'schema-inspector';
    const heading = document.createElement('div');
    heading.className = 'schema-section-heading';
    heading.textContent = `Index · ${indexName}`;
    wrapper.appendChild(heading);
    wrapper.appendChild(createSchemaTable(['SEQNO', 'CID', 'COLUMN'], rows.map((row) => [
      row[0], row[1], row[2] === null ? '(expression)' : row[2]
    ])));
    resultsElem.replaceChildren(wrapper);
    $('results-title').textContent = `Index · ${indexName}`;
    queryStatusElem.textContent = `${rows.length} indexed column${rows.length === 1 ? '' : 's'}`;
    setExportEnabled(false);
  } catch (error) {
    renderError(error.message);
    queryStatusElem.textContent = 'Index inspection failed';
  }
}

function renderSchemaInspector(tableName, columns, foreignKeys, indexes) {
  const wrapper = document.createElement('div');
  wrapper.className = 'schema-inspector';

  const intro = document.createElement('div');
  intro.className = 'schema-intro';
  const title = document.createElement('strong');
  title.textContent = tableName;
  const subtitle = document.createElement('span');
  subtitle.textContent = 'Table definition reported by SQLite';
  intro.append(title, subtitle);
  wrapper.appendChild(intro);

  wrapper.appendChild(createSchemaSection('COLUMNS', columns.length, createSchemaTable(
    ['#', 'COLUMN', 'TYPE', 'NOT NULL', 'DEFAULT', 'KEY'],
    columns.map((column) => [
      column[0],
      column[1],
      column[2] || '—',
      column[3] ? 'YES' : 'NO',
      column[4] === null ? '—' : column[4],
      column[5] ? `PK ${column[5]}` : '—'
    ])
  )));

  const fkRows = foreignKeys.map((fk) => [
    fk[0], fk[1], fk[3], fk[2], fk[4] || '(primary key)', fk[5], fk[6]
  ]);
  wrapper.appendChild(createSchemaSection('FOREIGN KEYS', fkRows.length, fkRows.length
    ? createSchemaTable(['ID', 'SEQ', 'FROM COLUMN', 'REFERENCES', 'TO COLUMN', 'ON UPDATE', 'ON DELETE'], fkRows)
    : createSchemaEmpty('No foreign keys are declared for this table.')));

  const indexRows = indexes.map((index) => {
    const info = db.exec(`PRAGMA index_info(${quoteIdentifier(index[1])});`);
    const names = info[0] ? info[0].values.map((row) => row[2] === null ? '(expression)' : row[2]) : [];
    return [index[1], index[2] ? 'UNIQUE' : 'NO', index[3] || '—', index[4] ? 'PARTIAL' : 'NO', names.join(', ') || '—'];
  });
  wrapper.appendChild(createSchemaSection('INDEXES', indexRows.length, indexRows.length
    ? createSchemaTable(['INDEX', 'UNIQUE', 'ORIGIN', 'PARTIAL', 'COLUMNS'], indexRows)
    : createSchemaEmpty('No indexes are defined for this table.')));

  const note = document.createElement('p');
  note.className = 'schema-footnote';
  note.textContent = 'Foreign keys shown here are declared constraints. Their presence does not guarantee that foreign-key enforcement is enabled or that existing rows satisfy them.';
  wrapper.appendChild(note);
  resultsElem.replaceChildren(wrapper);
}

function createSchemaSection(label, count, content) {
  const section = document.createElement('section');
  section.className = 'schema-section';
  const heading = document.createElement('div');
  heading.className = 'schema-section-heading';
  const name = document.createElement('strong');
  name.textContent = label;
  const badge = document.createElement('span');
  badge.textContent = count;
  heading.append(name, badge);
  section.append(heading, content);
  return section;
}

function createSchemaTable(headers, rows) {
  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table schema-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value === null || value === undefined ? '—' : String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  scroll.appendChild(table);
  return scroll;
}

function createSchemaEmpty(message) {
  const empty = document.createElement('p');
  empty.className = 'schema-empty';
  empty.textContent = message;
  return empty;
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
  if (!query) {
    showMessage('Enter a SELECT or other query to analyse.', 'error');
    return;
  }
  // SQLite's EXPLAIN QUERY PLAN accepts one statement. Avoid accidentally
  // treating semicolons inside quoted strings as statement separators.
  if (hasMultipleStatements(query)) {
    showMessage('Explain plan accepts one SQL statement at a time.', 'error');
    return;
  }

  const started = performance.now();
  explainQueryBtn.disabled = true;
  queryStatusElem.textContent = 'Analysing query plan…';
  resultsElem.innerHTML = '<div class="loading-state"><span class="spinner"></span>Building query plan</div>';

  window.setTimeout(() => {
    try {
      const result = db.exec(`EXPLAIN QUERY PLAN ${query};`);
      if (!result.length || !result[0].values.length) {
        renderEmptyResult('SQLite did not return a query plan for this statement.');
        queryStatusElem.textContent = 'No plan returned';
        return;
      }
      const plan = result[0];
      const indexes = Object.fromEntries(plan.columns.map((name, i) => [String(name).toLowerCase(), i]));
      const idIndex = indexes.id ?? 0;
      const parentIndex = indexes.parent ?? 1;
      const detailIndex = indexes.detail ?? 3;
      const rows = plan.values.map((row) => ({
        id: Number(row[idIndex]),
        parent: Number(row[parentIndex]),
        detail: String(row[detailIndex] ?? '')
      }));
      renderQueryPlan(rows);
      const elapsed = (performance.now() - started).toFixed(2);
      const scans = rows.filter((row) => /\bSCAN\b/i.test(row.detail)).length;
      const searches = rows.filter((row) => /\bSEARCH\b/i.test(row.detail)).length;
      queryStatusElem.textContent = `${rows.length} plan step${rows.length === 1 ? '' : 's'} · ${searches} search${searches === 1 ? '' : 'es'} · ${scans} scan${scans === 1 ? '' : 's'} · ${elapsed} ms`;
      setExportEnabled(false);
      showMessage('Query plan generated. This analyses the strategy; it does not execute the original query.', 'success', true);
    } catch (error) {
      renderError(error.message);
      queryStatusElem.textContent = 'Plan analysis failed';
      showMessage(error.message, 'error');
    } finally {
      explainQueryBtn.disabled = false;
    }
  }, 10);
}

function hasMultipleStatements(sql) {
  // SQLite itself is the final authority. This lightweight check catches
  // ordinary multi-statement input without rejecting semicolons in strings.
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote && sql[i + 1] === quote) { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === ';' && sql.slice(i + 1).trim()) return true;
  }
  return false;
}

function renderQueryPlan(rows) {
  const scans = rows.filter((row) => /\bSCAN\b/i.test(row.detail));
  const searches = rows.filter((row) => /\bSEARCH\b/i.test(row.detail));
  const indexed = rows.filter((row) => /\bUSING (?:COVERING )?INDEX\b/i.test(row.detail));
  const summary = document.createElement('div');
  summary.className = 'plan-summary';

  const metrics = [
    ['PLAN STEPS', rows.length],
    ['SEARCHES', searches.length],
    ['TABLE SCANS', scans.length],
    ['INDEX USE', indexed.length]
  ];
  metrics.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'plan-metric';
    const caption = document.createElement('span');
    caption.textContent = label;
    const number = document.createElement('strong');
    number.textContent = value;
    card.append(caption, number);
    summary.appendChild(card);
  });

  const note = document.createElement('div');
  note.className = 'plan-note';
  if (indexed.length) {
    note.classList.add('plan-good');
    note.textContent = 'Index detected: SQLite reports index-assisted lookup in this plan.';
  } else if (scans.length) {
    note.classList.add('plan-warn');
    note.textContent = 'Table scan detected: SQLite may need to inspect rows without using an index for this operation.';
  } else {
    note.textContent = 'Review the steps below to understand how SQLite intends to execute this statement.';
  }

  const tree = document.createElement('div');
  tree.className = 'plan-tree';
  const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots = [];
  rows.forEach((row) => {
    const node = byId.get(row.id);
    const parent = byId.get(row.parent);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  });

  const renderNode = (node, depth = 0) => {
    const item = document.createElement('div');
    item.className = 'plan-node';
    item.style.setProperty('--depth', Math.min(depth, 8));
    const detail = node.detail;
    const kind = /\bSEARCH\b/i.test(detail) ? 'search' :
      /\bSCAN\b/i.test(detail) ? 'scan' :
      /\bUSE TEMP B-TREE\b/i.test(detail) ? 'temp' : 'other';
    const icon = document.createElement('span');
    icon.className = `plan-node-icon ${kind}`;
    icon.innerHTML = kind === 'search' ? '<i class="fa-solid fa-magnifying-glass"></i>' :
      kind === 'scan' ? '<i class="fa-solid fa-table"></i>' :
      kind === 'temp' ? '<i class="fa-solid fa-box"></i>' : '<i class="fa-solid fa-code-branch"></i>';
    const content = document.createElement('div');
    content.className = 'plan-node-content';
    const label = document.createElement('strong');
    label.textContent = kind === 'search' ? 'SEARCH' : kind === 'scan' ? 'SCAN' : kind === 'temp' ? 'TEMPORARY STRUCTURE' : 'PLAN OPERATION';
    const description = document.createElement('code');
    description.textContent = detail;
    content.append(label, description);
    item.append(icon, content);
    tree.appendChild(item);
    node.children.forEach((child) => renderNode(child, depth + 1));
  };
  roots.forEach((root) => renderNode(root));

  const raw = document.createElement('details');
  raw.className = 'plan-raw';
  const rawSummary = document.createElement('summary');
  rawSummary.textContent = 'Raw SQLite plan rows';
  const rawTable = document.createElement('table');
  rawTable.className = 'data-table';
  const head = document.createElement('tr');
  ['ID', 'PARENT', 'DETAIL'].forEach((name) => {
    const th = document.createElement('th');
    th.textContent = name;
    head.appendChild(th);
  });
  const thead = document.createElement('thead');
  thead.appendChild(head);
  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    [row.id, row.parent, row.detail].forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  rawTable.append(thead, tbody);
  raw.append(rawSummary, rawTable);
  resultsElem.replaceChildren(summary, note, tree, raw);
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
