(() => {
  'use strict';

  const button = document.getElementById('explore-relationships');
  const output = document.getElementById('results');

  if (!button || !output) {
    console.error('Relationship Explorer: required HTML elements not found.');
    return;
  }

  button.addEventListener('click', analyzeRelationships);

  function quoteIdentifier(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
  }

  function analyzeRelationships() {
    if (typeof db === 'undefined' || !db) {
      showEmpty('Open a database before exploring relationships.');
      return;
    }

    try {
      const result = db.exec(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name;
      `);

      const tables = result.length
        ? result[0].values.map(row => String(row[0]))
        : [];

      const relationships = [];
      const tableInfo = new Map();

      // PASS 1: Collect metadata for every table.
      // This ensures referenced tables are available regardless
      // of their alphabetical order.

      tables.forEach(table => {
        const columnsResult = db.exec(
          `PRAGMA table_info(${quoteIdentifier(table)});`
        );

        const columns = columnsResult.length
          ? columnsResult[0].values
          : [];

        const primaryKey = columns
          .filter(row => Number(row[5]) > 0)
          .sort((a, b) => Number(a[5]) - Number(b[5]))
          .map(row => String(row[1]));

        tableInfo.set(table, {
          columns,
          primaryKey
        });
      });

      // PASS 2: Collect and group declared foreign keys.

      tables.forEach(table => {
        const foreignKeyResult = db.exec(
          `PRAGMA foreign_key_list(${quoteIdentifier(table)});`
        );

        if (!foreignKeyResult.length) return;

        const rows = foreignKeyResult[0].values;
        const groups = new Map();

        rows.forEach(row => {
          const id = Number(row[0]);

          if (!groups.has(id)) {
            groups.set(id, {
              id,
              source: table,
              target: String(row[2]),
              columns: [],
              onUpdate: String(row[5] || 'NO ACTION'),
              onDelete: String(row[6] || 'NO ACTION')
            });
          }

          groups.get(id).columns.push({
            sequence: Number(row[1]),
            from: String(row[3]),
            to: row[4] == null ? null : String(row[4])
          });
        });

        groups.forEach(group => {
          group.columns.sort(
            (a, b) => a.sequence - b.sequence
          );

          // Resolve omitted referenced columns using the target PK.
          const targetInfo = tableInfo.get(group.target);

          if (targetInfo) {
            group.columns.forEach(column => {
              if (column.to === null) {
                column.to =
                  targetInfo.primaryKey[column.sequence] || null;
              }
            });
          }

          relationships.push(group);
        });
      });

      render({
        tables,
        tableInfo,
        relationships
      });

    } catch (error) {
      console.error('Relationship analysis failed:', error);
      showEmpty('Relationship analysis failed: ' + error.message);
    }
  }

  function render(data) {
    const root = document.createElement('div');
    root.className = 'relationship-explorer';

    const header = document.createElement('div');
    header.className = 'relationship-header';

    const intro = document.createElement('div');

    const title = document.createElement('strong');
    title.textContent = 'Relationship Explorer';

    const description = document.createElement('p');
    description.textContent =
      'Declared foreign-key relationships discovered directly from SQLite metadata.';

    intro.append(title, description);

    const badge = document.createElement('span');
    badge.className = 'relationship-badge';
    badge.textContent =
      data.relationships.length + ' relationship' +
      (data.relationships.length === 1 ? '' : 's');

    header.append(intro, badge);
    root.appendChild(header);

    if (!data.tables.length) {
      addEmpty(root, 'No user tables were found in this database.');

      output.replaceChildren(root);
      updateStatus('No tables found');
      return;
    }

    if (!data.relationships.length) {
      addEmpty(
        root,
        'No declared foreign-key relationships were found. Tables may still be logically related, but SQLite does not declare those relationships.'
      );

      renderTableList(root, data.tables, data.tableInfo);
      addNote(root);

      output.replaceChildren(root);
      updateStatus('No declared relationships');
      return;
    }

    // Summary metrics.

    const summary = document.createElement('div');
    summary.className = 'relationship-summary';

    const tableMetric = createMetric(
      'TABLES',
      data.tables.length
    );

    const relationMetric = createMetric(
      'FOREIGN KEYS',
      data.relationships.length
    );

    const junctions = findJunctionTables(data.relationships);

    const junctionMetric = createMetric(
      'LIKELY JUNCTIONS',
      junctions.length
    );

    summary.append(
      tableMetric,
      relationMetric,
      junctionMetric
    );

    root.appendChild(summary);

    // Declared relationship cards.

    const section = document.createElement('section');
    section.className = 'relationship-section';

    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = 'DECLARED RELATIONSHIPS';

    section.appendChild(sectionTitle);

    data.relationships.forEach(relation => {
      section.appendChild(createRelationshipCard(relation));
    });

    root.appendChild(section);

    // Likely many-to-many junction tables.

    if (junctions.length) {
      const junctionSection = document.createElement('section');
      junctionSection.className = 'relationship-section';

      const heading = document.createElement('h3');
      heading.textContent = 'LIKELY MANY-TO-MANY TABLES';

      junctionSection.appendChild(heading);

      junctions.forEach(table => {
        const item = document.createElement('div');
        item.className = 'junction-card';

        const name = document.createElement('strong');
        name.textContent = table;

        const note = document.createElement('p');
        note.textContent =
          'This table references two other tables. It may function as a junction table; this is a structural inference, not a confirmed business relationship.';

        item.append(name, note);
        junctionSection.appendChild(item);
      });

      root.appendChild(junctionSection);
    }

    renderTableList(root, data.tables, data.tableInfo);
    addNote(root);

    output.replaceChildren(root);

    updateStatus(
      `${data.tables.length} tables · ${data.relationships.length} foreign keys`
    );
  }

  function createRelationshipCard(relation) {
    const card = document.createElement('article');
    card.className = 'relationship-card';

    const direction = document.createElement('div');
    direction.className = 'relationship-direction';

    const source = document.createElement('strong');
    source.textContent = relation.source;

    const arrow = document.createElement('span');
    arrow.className = 'relationship-arrow';
    arrow.textContent = '→';

    const target = document.createElement('strong');
    target.textContent = relation.target;

    direction.append(source, arrow, target);
    card.appendChild(direction);

    const mapping = document.createElement('div');
    mapping.className = 'relationship-mapping';

    relation.columns.forEach(column => {
      const row = document.createElement('div');
      row.className = 'mapping-row';

      const from = document.createElement('code');
      from.textContent = column.from;

      const connector = document.createElement('span');
      connector.textContent = 'references';

      const to = document.createElement('code');
      to.textContent = column.to || '(unresolved target column)';

      row.append(from, connector, to);
      mapping.appendChild(row);
    });

    card.appendChild(mapping);

    const rules = document.createElement('div');
    rules.className = 'relationship-rules';

    rules.textContent =
      `ON UPDATE ${relation.onUpdate} · ON DELETE ${relation.onDelete}`;

    card.appendChild(rules);

    if (relation.source === relation.target) {
      const self = document.createElement('span');
      self.className = 'relationship-tag';
      self.textContent = 'SELF-REFERENCE';
      card.appendChild(self);
    }

    if (relation.columns.length > 1) {
      const composite = document.createElement('span');
      composite.className = 'relationship-tag';
      composite.textContent = 'COMPOSITE KEY';
      card.appendChild(composite);
    }

    return card;
  }

  function findJunctionTables(relationships) {
    const grouped = new Map();

    relationships.forEach(relation => {
      if (!grouped.has(relation.source)) {
        grouped.set(relation.source, []);
      }

      grouped.get(relation.source).push(relation);
    });

    const result = [];

    grouped.forEach((relations, table) => {
      const distinctTargets = new Set(
        relations.map(relation => relation.target)
      );

      if (relations.length >= 2 && distinctTargets.size >= 2) {
        result.push(table);
      }
    });

    return result;
  }

  function renderTableList(root, tables, tableInfo) {
    const section = document.createElement('section');
    section.className = 'relationship-section';

    const heading = document.createElement('h3');
    heading.textContent = 'TABLE OVERVIEW';

    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'relationship-table-grid';

    tables.forEach(table => {
      const card = document.createElement('article');
      card.className = 'relationship-table-card';

      const name = document.createElement('strong');
      name.textContent = table;

      const info = tableInfo.get(table);

      const count = document.createElement('span');
      count.textContent =
        `${info.columns.length} columns · ` +
        `${info.primaryKey.length} primary-key columns`;

      card.append(name, count);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    root.appendChild(section);
  }

  function createMetric(label, value) {
    const card = document.createElement('div');
    card.className = 'relationship-metric';

    const heading = document.createElement('span');
    heading.textContent = label;

    const number = document.createElement('strong');
    number.textContent = String(value);

    card.append(heading, number);

    return card;
  }

  function addEmpty(parent, message) {
    const empty = document.createElement('div');
    empty.className = 'relationship-empty';
    empty.textContent = message;

    parent.appendChild(empty);
  }

  function addNote(parent) {
    const note = document.createElement('div');
    note.className = 'relationship-note';

    note.textContent =
      'Important: These relationships come from declared SQLite foreign keys. Their presence does not prove that existing rows satisfy the constraints. SQLite foreign-key enforcement depends on the connection configuration.';

    parent.appendChild(note);
  }

  function showEmpty(message) {
    const root = document.createElement('div');
    root.className = 'relationship-explorer';

    addEmpty(root, message);

    output.replaceChildren(root);
    updateStatus('Relationship analysis');
  }

  function updateStatus(message) {
    const title = document.getElementById('results-title');
    const status = document.getElementById('query-status');

    if (title) {
      title.textContent = 'Relationships';
    }

    if (status) {
      status.textContent = message;
    }
  }
})();