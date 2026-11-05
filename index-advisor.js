(() => {
  const button = document.getElementById('advise-indexes');
  const output = document.getElementById('results');
  if (!button || !output) return;
  button.addEventListener('click', analyze);

  const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
  const status = () => {
    const title = document.getElementById('results-title');
    const queryStatus = document.getElementById('query-status');
    if (title) title.textContent = 'Index advice';
    if (queryStatus) queryStatus.textContent = 'Analysis complete · no index changes made';
  };
  const showMessage = message => {
    const root = document.createElement('div');
    root.className = 'index-advisor';
    const item = document.createElement('div');
    item.className = 'advisor-empty';
    item.textContent = message;
    root.appendChild(item);
    output.replaceChildren(root);
    status();
  };

  function analyze() {
    if (typeof db === 'undefined' || !db) return showMessage('Open a database before running the Index Advisor.');
    const raw = typeof editor !== 'undefined' && editor ? editor.getValue().trim() : '';
    if (!raw) return showMessage('Enter a SELECT query first.');

    const masked = raw.replace(/'(?:''|[^'])*'/g, "''");
    if (/;\s*\S/.test(masked)) return showMessage('The advisor accepts one SQL statement at a time.');
    const sql = raw.replace(/^\s*EXPLAIN\s+QUERY\s+PLAN\s+/i, '').replace(/;\s*$/, '');
    if (!/^\s*SELECT\b/i.test(sql)) return showMessage('Currently supports SELECT statements only. No database changes are made.');

    try {
      const plan = db.exec('EXPLAIN QUERY PLAN ' + sql);
      const details = plan.length ? plan[0].values.map(row => String(row[3] || '')) : [];
      const scans = details.filter(x => /\bSCAN\b/i.test(x) && !/\bUSING\s+(?:COVERING\s+)?INDEX\b/i.test(x));
      const sourcePattern = /\b(?:FROM|JOIN)\s+("[^"]+"|[A-Za-z_][\w$]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w$]*))?/gi;
      const sources = [];
      let match;
      while ((match = sourcePattern.exec(sql))) {
        const table = match[1].replace(/^"|"$/g, '').replace(/""/g, '"');
        const alias = match[2] && !/^(WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|ORDER|LIMIT|CROSS)$/i.test(match[2]) ? match[2] : table;
        if (!sources.some(x => x.table.toLowerCase() === table.toLowerCase())) sources.push({table, alias});
      }

      const predicatePattern = /(?:\b([A-Za-z_][\w$]*)\s*\.\s*)?([A-Za-z_][\w$]*)\s*(=|==|>=|<=|>|<|LIKE\b|IN\s*\()/gi;
      const predicates = [];
      let predicate;
      while ((predicate = predicatePattern.exec(sql))) {
        const source = predicate[1]
          ? sources.find(x => x.alias.toLowerCase() === predicate[1].toLowerCase() || x.table.toLowerCase() === predicate[1].toLowerCase())
          : sources.length === 1 ? sources[0] : null;
        if (!source || /^(SELECT|FROM|JOIN|WHERE|AND|OR|ON|ORDER|GROUP|BY|LIMIT|OFFSET|AS|ASC|DESC|IS|NOT|NULL|DISTINCT|CASE|WHEN|THEN|ELSE|END)$/i.test(predicate[2])) continue;
        predicates.push({table: source.table, column: predicate[2], operator: predicate[3].toUpperCase()});
      }

      const suggestions = [];
      sources.forEach(source => {
        const schema = db.exec('PRAGMA table_info(' + quote(source.table) + ')');
        if (!schema.length) return;
        const columns = new Set(schema[0].values.map(row => String(row[1]).toLowerCase()));
        const indexes = db.exec('PRAGMA index_list(' + quote(source.table) + ')');
        const indexedLeadingColumns = new Set();
        if (indexes.length) indexes[0].values.forEach(row => {
          const info = db.exec('PRAGMA index_info(' + quote(String(row[1])) + ')');
          if (info.length && info[0].values[0] && info[0].values[0][2] != null) {
            indexedLeadingColumns.add(String(info[0].values[0][2]).toLowerCase());
          }
        });
        predicates
          .filter(x => x.table.toLowerCase() === source.table.toLowerCase()
            && columns.has(x.column.toLowerCase())
            && !indexedLeadingColumns.has(x.column.toLowerCase()))
          .forEach(x => {
            if (!suggestions.some(y => y.table === x.table && y.column.toLowerCase() === x.column.toLowerCase())) suggestions.push(x);
          });
      });

      render({sources, scans, suggestions});
    } catch (error) {
      showMessage('Could not analyze this query: ' + error.message);
    }
  }

  function render(data) {
    const root = document.createElement('div');
    root.className = 'index-advisor';
    const header = document.createElement('div');
    header.className = 'advisor-header';
    const intro = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Index Advisor';
    const description = document.createElement('p');
    description.textContent = 'Suggestions use the current query, SQLite query plan, table schema, and existing indexes.';
    intro.append(title, description);
    const badge = document.createElement('span');
    badge.className = 'advisor-badge';
    badge.textContent = data.suggestions.length + ' candidate' + (data.suggestions.length === 1 ? '' : 's');
    header.append(intro, badge);
    root.appendChild(header);

    if (!data.sources.length) {
      addEmpty(root, 'Could not identify a simple table source. CTEs, subqueries, and complex joins may need manual review.');
    } else if (!data.suggestions.length) {
      addEmpty(root, data.scans.length
        ? 'A table scan was detected, but no safe missing filter index was identified. Scans can be optimal for small tables or queries returning many rows.'
        : 'No obvious missing index was found for the detected predicates.');
    } else {
      data.suggestions.forEach(item => {
        const card = document.createElement('article');
        card.className = 'advisor-card';
        const top = document.createElement('div');
        top.className = 'advisor-card-top';
        const name = document.createElement('strong');
        name.textContent = item.table + '.' + item.column;
        const operator = document.createElement('span');
        operator.className = 'advisor-tag';
        operator.textContent = item.operator;
        top.append(name, operator);
        const reason = document.createElement('p');
        reason.textContent = 'This column appears in a filter predicate. An index may help SQLite locate matching rows without scanning the full table.';
        const sql = document.createElement('code');
        sql.textContent = 'CREATE INDEX ' + quote('idx_' + item.table + '_' + item.column)
          + ' ON ' + quote(item.table) + ' (' + quote(item.column) + ');';
        card.append(top, reason, sql);
        root.appendChild(card);
      });
    }

    const note = document.createElement('div');
    note.className = 'advisor-note';
    note.textContent = 'Review before applying: indexes use storage and add write overhead. A full scan is not automatically bad. Suggestions only — the advisor never creates or changes indexes.';
    root.appendChild(note);
    output.replaceChildren(root);
    status();
  }

  function addEmpty(parent, message) {
    const item = document.createElement('div');
    item.className = 'advisor-empty';
    item.textContent = message;
    parent.appendChild(item);
  }
})();
