(() => {
  'use strict';

  const toggle = document.getElementById('benchmark-query');
  const panel = document.getElementById('benchmark-panel');
  const runButton = document.getElementById('benchmark-run');
  const closeButton = document.getElementById('benchmark-close');
  const iterationsInput = document.getElementById('benchmark-iterations');
  const output = document.getElementById('benchmark-results');
  const status = document.getElementById('benchmark-status');

  if (!toggle || !panel || !runButton || !closeButton ||
      !iterationsInput || !output || !status) {
    console.error('Query Benchmark: required HTML elements not found.');
    return;
  }

  toggle.addEventListener('click', () => {
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    runBenchmark();
  });

  runButton.addEventListener('click', runBenchmark);

  closeButton.addEventListener('click', () => {
    panel.hidden = true;
  });

  function getMainStatement(sql) {
    let depth = 0;
    let quote = null;
    const words = [];

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      const next = sql[i + 1];

      if (quote) {
        if (ch === quote && next === quote) {
          i++;
          continue;
        }

        if (ch === quote) quote = null;
        continue;
      }

      if (ch === '-' && next === '-') {
        while (i < sql.length && sql[i] !== '\n') i++;
        continue;
      }

      if (ch === '/' && next === '*') {
        i += 2;

        while (i < sql.length - 1 &&
               !(sql[i] === '*' && sql[i + 1] === '/')) {
          i++;
        }

        i++;
        continue;
      }

      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }

      if (ch === '[') {
        quote = ']';
        continue;
      }

      if (ch === '(') {
        depth++;
        continue;
      }

      if (ch === ')') {
        depth--;
        continue;
      }

      if (depth === 0 && /[A-Za-z_]/.test(ch)) {
        let word = ch;

        while (i + 1 < sql.length &&
               /[A-Za-z0-9_]/.test(sql[i + 1])) {
          word += sql[++i];
        }

        words.push(word.toUpperCase());
      }
    }

    const commands = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'];

    return words.find(word => commands.includes(word)) || null;
  }

  function hasMultipleStatements(sql) {
    let quote = null;
    let terminated = false;

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      const next = sql[i + 1];

      if (quote) {
        if (ch === quote && next === quote) {
          i++;
          continue;
        }

        if (ch === quote) quote = null;
        continue;
      }

      if (ch === '-' && next === '-') {
        while (i < sql.length && sql[i] !== '\n') i++;
        continue;
      }

      if (ch === '/' && next === '*') {
        i += 2;

        while (i < sql.length - 1 &&
               !(sql[i] === '*' && sql[i + 1] === '/')) {
          i++;
        }

        i++;
        continue;
      }

      if (ch === "'" || ch === '"' || ch === '`') {
        if (terminated) return true;
        quote = ch;
        continue;
      }

      if (ch === '[') {
        if (terminated) return true;
        quote = ']';
        continue;
      }

      if (ch === ';') {
        terminated = true;
        continue;
      }

      if (terminated && !/\s/.test(ch)) {
        return true;
      }
    }

    return false;
  }

  function runBenchmark() {
    if (typeof db === 'undefined' || !db) {
      showMessage('Open a database before benchmarking.');
      return;
    }

    const query = typeof editor !== 'undefined' && editor
      ? editor.getValue().trim()
      : '';

    if (!query) {
      showMessage('Enter a SQL query first.');
      return;
    }

    if (hasMultipleStatements(query)) {
      showMessage('Benchmarking accepts one SQL statement at a time.');
      return;
    }

    if (getMainStatement(query) !== 'SELECT') {
      showMessage(
        'Only read-only SELECT queries and SELECT-based CTEs can be benchmarked.'
      );
      return;
    }

    const iterations = Number(iterationsInput.value);

    if (!Number.isInteger(iterations) ||
        iterations < 2 ||
        iterations > 30) {
      showMessage('Choose between 2 and 30 benchmark runs.');
      return;
    }

    output.replaceChildren();
    status.textContent = 'Preparing benchmark…';

    runButton.disabled = true;
    toggle.disabled = true;

    window.setTimeout(() => {
      try {
        // Warm-up execution is excluded from the measurements.
        db.exec(query);

        const timings = [];
        let lastResult = null;

        for (let i = 0; i < iterations; i++) {
          const started = performance.now();
          const resultSets = db.exec(query);
          const elapsed = performance.now() - started;

          timings.push(elapsed);

          lastResult = resultSets.length
            ? resultSets[0]
            : null;
        }

        if (!lastResult) {
          throw new Error('The query did not return a result set.');
        }

        timings.sort((a, b) => a - b);

        const total = timings.reduce((sum, value) => sum + value, 0);
        const average = total / timings.length;

        const middle = Math.floor(timings.length / 2);

        const median = timings.length % 2
          ? timings[middle]
          : (timings[middle - 1] + timings[middle]) / 2;

        renderResults({
          iterations,
          average,
          median,
          fastest: timings[0],
          slowest: timings[timings.length - 1],
          rows: lastResult.values.length,
          columns: lastResult.columns.length
        });

        status.textContent =
          `${iterations} runs completed · 1 warm-up excluded`;

      } catch (error) {
        showMessage(`Benchmark failed: ${error.message}`);

      } finally {
        runButton.disabled = false;
        toggle.disabled = false;
      }
    }, 25);
  }

  function renderResults(data) {
    output.replaceChildren();

    const metrics = [
      ['AVERAGE', data.average],
      ['MEDIAN', data.median],
      ['FASTEST', data.fastest],
      ['SLOWEST', data.slowest]
    ];

    const grid = document.createElement('div');
    grid.className = 'benchmark-grid';

    metrics.forEach(([label, value]) => {
      const card = document.createElement('article');
      card.className = 'benchmark-metric';

      const heading = document.createElement('span');
      heading.textContent = label;

      const number = document.createElement('strong');
      number.textContent = `${value.toFixed(3)} ms`;

      card.append(heading, number);
      grid.appendChild(card);
    });

    const summary = document.createElement('div');
    summary.className = 'benchmark-summary';

    summary.textContent =
      `${data.iterations} measured runs · ` +
      `${data.rows.toLocaleString()} rows returned · ` +
      `${data.columns} columns`;

    const note = document.createElement('p');
    note.className = 'benchmark-note';
    note.textContent =
      'Measurements include SQL execution and result materialisation in SQL.js. ' +
      'The warm-up run is excluded. Results can vary with browser load and cache state.';

    output.append(grid, summary, note);
  }

  function showMessage(message) {
    output.replaceChildren();

    const error = document.createElement('div');
    error.className = 'benchmark-error';
    error.textContent = message;

    output.appendChild(error);
    status.textContent = 'Benchmark not completed';
  }
})();
document.querySelectorAll('.editor-tools-menu button').forEach(button => {
  button.addEventListener('click', () => {
    const menu = button.closest('.editor-tools');
    if (menu) menu.open = false;
  });
});