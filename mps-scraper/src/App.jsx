import { useMemo, useState } from "react";
import "./App.css";

function cleanShortageItem(value) {
  return value
    // Remove surrounding quotation marks and spaces
    .replace(/^["'\s]+|["'\s]+$/g, "")

    // Remove quantities such as X1, x14 or 52off
    .replace(/\s+[xX]\s*\d+\b/g, "")
    .replace(/\s+\d+\s*off\b/gi, "")

    // Clean repeated spaces
    .replace(/\s+/g, " ")
    .trim();
}

function extractShortageCodes(comments) {
  const normalised = comments
    .replace(/\r?\n/g, " ")
    .replace(/[“”"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  /*
    Remove dates and notes such as:
    (TBC)
    (05/08)
    (Pre cut 03/08)
    (52)
    (REJECTS)
  */
  const withoutNotes = normalised.replace(/\([^)]*\)/g, " ");

  /*
    Remove shortage labels but preserve the actual component codes.

    Handles:
    Shortage -
    Shortages -
    Raw shortage -
    Raw shortages -
    RAW -
  */
  const withoutLabels = withoutNotes
    .replace(/\braw\s+shortages?\s*[-–:]?\s*/gi, " ")
    .replace(/\bshortages?\s*[-–:]?\s*/gi, " ")
    .replace(/\braw\s*[-–:]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  /*
    Add a comma where two component codes are separated only by spaces.

    Example:
    CEYP-DEEP-CORE-ALU CEYP-TFR-ALU

    becomes:
    CEYP-DEEP-CORE-ALU, CEYP-TFR-ALU
  */
  const separated = withoutLabels.replace(
    /([A-Z0-9][A-Z0-9./-]*-[A-Z0-9./-]+)\s+(?=[A-Z0-9]+(?:-[A-Z0-9./]+)+\b)/g,
    "$1, "
  );

  return separated
    /*
      Split on:
      - commas
      - slashes surrounded by spaces

      This preserves internal slashes in codes such as:
      TINF-MINI-B-350/700/1050-22DALI
      TRA-9004/TRL-B
    */
    .split(/\s*,\s*|\s+\/\s+/)
    .map(cleanShortageItem)
    .filter((item) => {
      if (!item) {
        return false;
      }

      /*
        Accept component-code-shaped values, plus intentional generic
        shortages such as Track & Accs.
      */
      return (
        /^[A-Z0-9]+(?:[-/][A-Z0-9.]+)+(?:\s+[A-Z0-9]+)?$/i.test(item) ||
        /^tracks?\s*&\s*acc(?:s|es)$/i.test(item)
      );
    });
}

function buildRows(input) {
  const rows = [];
  const physicalLines = input.split(/\r?\n/);

  physicalLines.forEach((line) => {
    if (!line.trim()) {
      return;
    }

    const columns = line.split("\t");
    const possibleSalesOrder = String(columns[1] ?? "").trim();

    /*
      A normal Excel row has an eight-digit sales order in column 2.
      Lines without one are treated as continuation lines from multiline cells.
    */
    if (/^\d{8}$/.test(possibleSalesOrder)) {
      rows.push(line);
    } else if (rows.length > 0) {
      rows[rows.length - 1] += ` ${line.trim()}`;
    }
  });

  return rows;
}

function parseShortages(input) {
  const shortageMap = new Map();
  const rows = buildRows(input);

  rows.forEach((row) => {
    const columns = row.split("\t");

    const salesOrder = String(columns[1] ?? "").trim();
    const comments = String(columns[6] ?? "").trim();

    // Ignore rows without a valid sales order
    if (!/^\d{8}$/.test(salesOrder)) {
      return;
    }

    // Include normal shortages, raw shortages and raw entries
    if (!/\b(?:raw|shortages?)\b/i.test(comments)) {
      return;
    }

    const shortages = extractShortageCodes(comments);

    shortages.forEach((shortage) => {
      const normalisedShortage = shortage.toUpperCase();

      if (!shortageMap.has(normalisedShortage)) {
        shortageMap.set(normalisedShortage, new Set());
      }

      shortageMap.get(normalisedShortage).add(salesOrder);
    });
  });

  return Array.from(shortageMap.entries())
    .map(([shortage, orders]) => ({
      shortage,
      orders: Array.from(orders).sort(),
    }))
    .sort((a, b) => a.shortage.localeCompare(b.shortage));
}

function App() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");

  const filteredResults = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    if (!searchTerm) {
      return results;
    }

    return results.filter(
      (result) =>
        result.shortage.toLowerCase().includes(searchTerm) ||
        result.orders.some((order) => order.includes(searchTerm))
    );
  }, [results, search]);

  function handleScrape() {
    if (!input.trim()) {
      setResults([]);
      setMessage("Paste the Excel data before scraping.");
      return;
    }

    const parsedResults = parseShortages(input);

    setResults(parsedResults);

    setMessage(
      parsedResults.length
        ? `Found ${parsedResults.length} unique shortages.`
        : "No shortage rows were found."
    );
  }

  function handleClear() {
    setInput("");
    setResults([]);
    setSearch("");
    setMessage("");
  }

  return (
    <main className="app">
      <section className="container">
        <header className="header">
          <p className="eyebrow">Phos Production Tools</p>

          <h1>MPS Shortage Scraper</h1>

          <p>
            Copy the rows from Excel, paste them below and group each shortage
            by sales order.
          </p>
        </header>

        <section className="panel">
          <label htmlFor="excel-data">Paste Excel data</label>

          <textarea
            id="excel-data"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Copy the required rows from Excel and paste them here..."
            spellCheck="false"
          />

          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={handleScrape}
            >
              Scrape shortages
            </button>

            <button
              type="button"
              className="secondary"
              onClick={handleClear}
            >
              Clear
            </button>
          </div>

          {message && <p className="message">{message}</p>}
        </section>

        {results.length > 0 && (
          <section className="panel results-panel">
            <div className="results-header">
              <div>
                <h2>Shortage results</h2>

                <p>{results.length} unique component codes</p>
              </div>

              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search shortage or SO..."
              />
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Shortage</th>
                    <th>Sales orders</th>
                    <th>Order count</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredResults.map((result) => (
                    <tr key={result.shortage}>
                      <td className="shortage-code">
                        {result.shortage}
                      </td>

                      <td>{result.orders.join(", ")}</td>

                      <td>{result.orders.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredResults.length === 0 && (
              <p className="empty-results">
                No matching results found.
              </p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

export default App;