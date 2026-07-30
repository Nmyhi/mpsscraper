import { useMemo, useState } from "react";
import "./App.css";

function cleanShortageItem(value) {
  return value
    // Remove labels such as "Shortage -" and "Raw shortage -"
    .replace(/\braw\s+shortages?\s*[-–:]?\s*/gi, "")
    .replace(/\bshortages?\s*[-–:]?\s*/gi, "")

    // Remove bracketed dates and notes
    .replace(/\([^)]*\)/g, "")

    // Remove quantities such as X1, x14 or 52off
    .replace(/\s+[xX]\s*\d+\b/g, "")
    .replace(/\s+\d+\s*off\b/gi, "")

    // Remove surrounding quotation marks and spaces
    .replace(/^["'\s-]+|["'\s-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseShortages(input) {
  const shortageMap = new Map();

  const rows = input
    .split(/\r?\n/)
    .map((row) => row.trimEnd())
    .filter(Boolean);

  rows.forEach((row) => {
    const columns = row.split("\t");

    const salesOrder = String(columns[1] ?? "").trim();
    const comments = String(columns[6] ?? "").trim();

    // Ignore section headings and rows without a valid sales order
    if (!/^\d{8}$/.test(salesOrder)) {
      return;
    }

    // Only scrape rows explicitly mentioning shortage or shortages
    if (!/\bshortages?\b/i.test(comments)) {
      return;
    }

    /*
      Split only on:
      - commas
      - slashes surrounded by spaces

      This preserves slashes inside valid codes such as:
      TINF-MINI-B-350/700/1050-22DALI
      NF-27/65-...
    */
    const parts = comments
      .replace(/\r?\n/g, " ")
      .split(/\s+\/\s+|,/)
      .map(cleanShortageItem)
      .filter(Boolean);

    parts.forEach((part) => {
      // Ignore text left over before an embedded shortage label
      const embeddedShortage = part.match(
        /(?:raw\s+)?shortages?\s*[-–:]?\s*(.+)$/i
      );

      const shortage = cleanShortageItem(
        embeddedShortage ? embeddedShortage[1] : part
      );

      if (!shortage) {
        return;
      }

      if (!shortageMap.has(shortage)) {
        shortageMap.set(shortage, new Set());
      }

      shortageMap.get(shortage).add(salesOrder);
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
          <p className="eyebrow">MPS Production Tools</p>
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
            <button type="button" className="primary" onClick={handleScrape}>
              Scrape shortages
            </button>

            <button type="button" className="secondary" onClick={handleClear}>
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
                      <td className="shortage-code">{result.shortage}</td>
                      <td>{result.orders.join(", ")}</td>
                      <td>{result.orders.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredResults.length === 0 && (
              <p className="empty-results">No matching results found.</p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

export default App;