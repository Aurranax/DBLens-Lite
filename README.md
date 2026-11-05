# DBLens

**A lightweight, browser-based SQLite development workspace for database exploration, schema inspection, query analysis, and performance benchmarking.**

DBLens is a client-side SQLite viewer and developer workspace built with HTML, CSS, vanilla JavaScript, and SQL.js/WebAssembly. It allows you to load SQLite databases directly in your browser, explore database structures, execute SQL queries, analyse query execution plans, and benchmark query performance without setting up a database server.

> **Project status:** Early Development · Preview 0.1.0
> **Repository:** [Aurranax/SQLite-Viewer](https://github.com/Aurranax/SQLite-Viewer)
> **Development branch:** `feature/dblens`

## Features

| Feature                   | Description                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **SQL Editor**            | Write and execute SQL queries with syntax highlighting through CodeMirror.                                      |
| **Database Explorer**     | Browse tables, views, and indexes in the loaded database.                                                       |
| **Schema Inspector**      | Inspect columns, declared types, primary keys, default values, foreign keys, and indexes using SQLite metadata. |
| **Query Plan Analyser**   | Visualise `EXPLAIN QUERY PLAN` output, including table scans, searches, index usage, and query-plan structure.  |
| **Index Advisor**         | Suggest potential indexes using query-plan and schema information. Recommendations do not modify the database.  |
| **Relationship Explorer** | Visualise relationships declared through SQLite foreign-key constraints.                                        |
| **Query History**         | Store up to 100 recent query executions locally using browser `localStorage`.                                   |
| **Query Benchmark**       | Compare repeated query execution times using warm-up and measured runs.                                         |
| **Result Export**         | Export query results as CSV or JSON.                                                                            |
| **Themes**                | Switch between dark and light themes.                                                                           |

## Getting Started

### Prerequisites

* Windows 11, macOS, or Linux
* Git
* Python 3

DBLens is a static browser application. No database server, backend, or framework installation is required.

### Run Locally

**1. Clone the repository:**

```powershell
git clone https://github.com/Aurranax/SQLite-Viewer.git
cd SQLite-Viewer
```

**2. Switch to the development branch:**

```powershell
git checkout feature/dblens
```

**3. Start a local HTTP server:**

```powershell
py -m http.server 8000
```

If the `py` command is unavailable, use:

```powershell
python -m http.server 8000
```

**4. Open DBLens in your browser:**

http://localhost:8000

Keep the terminal running while using the application. Press `Ctrl+C` to stop the server.

> **Note:** Serve the project through HTTP rather than opening `index.html` directly. This allows the SQL.js WebAssembly resources to load correctly.

## Using DBLens

1. Open DBLens in your browser.
2. Load a SQLite database file using the database-loading control.
3. Select a table in the Database Explorer to inspect its contents.
4. Use the SQL Editor to write and execute queries.
5. Open the Schema Inspector to examine table structures, columns, and indexes.
6. Use the Query Plan Analyser to inspect SQLite's `EXPLAIN QUERY PLAN` output.
7. Explore declared foreign-key relationships using the Relationship Explorer.
8. Benchmark queries and compare execution times.
9. Export query results as CSV or JSON.

**Tip:** Always inspect the actual database schema before writing queries. For example:

```sql
PRAGMA table_info("customers");
```

Do not assume that a table contains a particular column simply because it is commonly found in other databases.

## How It Works

DBLens runs in the browser using SQL.js, which provides SQLite compiled to WebAssembly.

The general workflow is:

1. The user selects a SQLite database file.
2. The browser reads the selected file.
3. SQL.js loads the database into browser memory.
4. SQL queries and SQLite metadata operations execute locally.
5. Results, schema information, and query analysis are displayed in the interface.

The selected database is not uploaded to a DBLens-hosted backend. Database processing takes place locally in the browser.

### Technology Stack

| Technology                      | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| **HTML5**                       | Application structure                     |
| **CSS3**                        | Interface styling and themes              |
| **Vanilla JavaScript**          | Application logic and interactions        |
| **SQL.js / SQLite WebAssembly** | SQLite database processing in the browser |
| **CodeMirror 5**                | SQL editor and syntax highlighting        |
| **Browser localStorage**        | Local query-history persistence           |

The project intentionally uses a lightweight frontend without introducing a large application framework.

## Project Structure

```text
SQLite-Viewer/
│
├── index.html          # Application interface
├── style.css           # Styling and themes
├── script.js           # Application logic and features
│
├── sql.js              # SQL.js library
├── sql-wasm.wasm       # SQLite WebAssembly module
│
├── README.md           # Project documentation
└── LICENSE             # License information
```

## Technical Notes and Limitations

* **Database size:** The current preview rejects database files larger than 150 MB.
* **Memory usage:** Database contents are loaded into browser memory. Available memory and browser performance affect practical database size.
* **Query History:** Stores up to 100 recent executions in browser `localStorage`. History is local to the browser.
* **Relationship Explorer:** Displays relationships represented by declared SQLite foreign-key constraints. It does not infer relationships from similar column names.
* **Index Advisor:** Provides recommendations only. It does not automatically create, modify, or apply indexes.
* **Query Benchmark:** Results depend on the user's hardware, browser, database state, and runtime conditions. Measurements should be treated as indicative rather than universal performance guarantees.
* **Query Plan Analyser:** Uses SQLite's `EXPLAIN QUERY PLAN` output to analyse execution plans. It does not execute the original query simply to display its plan.
* **External dependencies:** Some interface dependencies are loaded from external CDNs. An internet connection may therefore be required to load certain resources.

## Development

DBLens is actively developed on the `feature/dblens` branch.

For local development:

1. Clone the repository and switch to the development branch.
2. Start the local HTTP server.
3. Edit the relevant HTML, CSS, or JavaScript files.
4. Refresh the browser to test changes.
5. Verify that the affected workflows work correctly before committing.

Before committing, review the working tree:

```powershell
git status
git diff --check
git diff
```

Test changes in the browser. A successful JavaScript syntax check alone does not guarantee that a feature works correctly from the user's perspective.

## Project Background and Attribution

DBLens is a redesigned and extended version of the upstream [SQLite-Viewer project by bjmdevelopers](https://github.com/bjmdevelopers/SQLite-Viewer).

The DBLens interface and additional developer tools are being developed in the `feature/dblens` branch of this repository.

The upstream project and its contributors should receive appropriate attribution in accordance with the existing license and notices.

See the repository's `LICENSE` file for applicable license terms. Preserve upstream copyright and license notices when modifying or redistributing source files.

## Roadmap

The current focus is on improving the stability, usability, and reliability of the existing implementation.

Planned improvements include:

* Capturing genuine screenshots of the running application.
* Reviewing error handling and browser compatibility.
* Improving accessibility and interface consistency.
* Testing SQL edge cases and database metadata handling.
* Adding automated tests for schema inspection, identifier quoting, empty databases, and other edge cases.
* Considering a GitHub Pages deployment after the local application is stable.

## Contributing

Issues, bug reports, and improvement suggestions are welcome.

When reporting an issue, include:

* Expected behaviour.
* Actual behaviour.
* Steps to reproduce the issue.
* Browser and operating-system details, where relevant.

For feature contributions, update the documentation and test the affected workflows before submitting changes.
