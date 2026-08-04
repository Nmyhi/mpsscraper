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

function extractDateFromText(value) {
  const matches = [...value.matchAll(/\(([^)]*)\)/g)];

  /*
    Work backwards through bracketed notes so the nearest date is preferred.

    Handles:
    (04/08)
    (Pre cut 04/08)
    (Cust length 17/08)
    (05/08/2026)
  */
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const bracketText = matches[index][1];

    const dateMatch = bracketText.match(
      /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/
    );

    if (dateMatch) {
      return dateMatch[1];
    }
  }

  return "";
}

function extractShortageItems(comments) {
  const normalised = comments
    .replace(/\r?\n/g, " ")
    .replace(/[“”"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  /*
    Separate repeated shortage labels.

    Example:
    ITEM-A (TBC) Shortage - ITEM-B (05/08)
  */
  const separatedLabels = normalised
    .replace(
      /\)\s+(?=(?:raw\s+)?shortages?\s*[-–:])/gi,
      ") / "
    )
    .replace(/\)\s+(?=raw\s*[-–:])/gi, ") / ");

  /*
    First split into shortage groups using spaced slashes.

    Internal slashes remain untouched:
    TINF-MINI-B-350/700/1050-22DALI
  */
  const groups = separatedLabels.split(/\s+\/\s+/);

  const extractedItems = [];

  groups.forEach((group) => {
    /*
      Add commas where two component codes have only spaces between them.

      Example:
      CEYP-DEEP-CORE-ALU (TBC) CEYP-TFR-ALU (05/08)
    */
    const separatedCodes = group.replace(
      /(\([^)]*\)|[A-Z0-9./-]+)\s+(?=[A-Z0-9]+(?:-[A-Z0-9./]+)+\b)/g,
      "$1, "
    );

    const rawItems = separatedCodes.split(/\s*,\s*/);

    let inheritedDate = "";
    let inheritedTbc = false;

    /*
      Excel commonly puts one bracketed status at the end of several
      comma-separated component codes:

      ITEM-A, ITEM-B, ITEM-C (TBC)

      Process backwards so all three inherit TBC.
    */
    const groupItems = rawItems
      .reverse()
      .map((rawItem) => {
        const date = extractDateFromText(rawItem);
        const hasTbc = /\(\s*TBC\s*\)/i.test(rawItem);

        if (date) {
          inheritedDate = date;
        }

        if (hasTbc) {
          inheritedTbc = true;
        }

        const shortage = cleanShortageItem(
          rawItem
            .replace(/\braw\s+shortages?\s*[-–:]?\s*/gi, "")
            .replace(/\bshortages?\s*[-–:]?\s*/gi, "")
            .replace(/\braw\s*[-–:]\s*/gi, "")
            .replace(/\([^)]*\)/g, "")
        );

        return {
          shortage,
          date: date || inheritedDate,
          isTbc: hasTbc || inheritedTbc,
        };
      })
      .reverse();

    extractedItems.push(...groupItems);
  });

  return extractedItems.filter(({ shortage }) => {
    if (!shortage) {
      return false;
    }

    return (
      /^[A-Z0-9]+(?:[-/][A-Z0-9.]+)+(?:\s+[A-Z0-9]+)?$/i.test(
        shortage
      ) ||
      /^tracks?\s*&\s*acc(?:s|es)$/i.test(shortage)
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
      Lines without one are continuation lines from multiline Excel cells.
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
  const tbcMap = new Map();
  const datedItems = [];
  const rows = buildRows(input);;

  rows.forEach((row) => {
    const columns = row.split("\t");

    const salesOrder = String(columns[1] ?? "").trim();
    const comments = String(columns[6] ?? "").trim();

    if (!/^\d{8}$/.test(salesOrder)) {
      return;
    }

    if (!/\b(?:raw|shortages?)\b/i.test(comments)) {
      return;
    }

    const shortageItems = extractShortageItems(comments);

    shortageItems.forEach(({ shortage, date, isTbc }) => {
  const normalisedShortage = shortage.toUpperCase();

  /*
    Main shortage results.
  */
  if (!shortageMap.has(normalisedShortage)) {
    shortageMap.set(normalisedShortage, new Set());
  }

  shortageMap.get(normalisedShortage).add(salesOrder);

  /*
    Current-week dated results.
  */
  if (date) {
    datedItems.push({
      shortage: normalisedShortage,
      salesOrder,
      date,
    });
  }

  /*
    Separate TBC section.
  */
  if (isTbc) {
    if (!tbcMap.has(normalisedShortage)) {
      tbcMap.set(normalisedShortage, new Set());
    }

    tbcMap.get(normalisedShortage).add(salesOrder);
  }
});
  });

  const shortages = Array.from(shortageMap.entries())
    .map(([shortage, orders]) => ({
      shortage,
      orders: Array.from(orders).sort(),
    }))
    .sort((a, b) => a.shortage.localeCompare(b.shortage));

    const tbcShortages = Array.from(tbcMap.entries())
  .map(([shortage, orders]) => ({
    shortage,
    orders: Array.from(orders).sort(),
  }))
  .sort((a, b) => a.shortage.localeCompare(b.shortage));

  return {
  shortages,
  datedItems,
  tbcShortages,
};
}

function parseShortDate(dateText, referenceDate = new Date()) {
  const parts = dateText.split("/").map(Number);

  if (parts.length < 2 || parts.some(Number.isNaN)) {
    return null;
  }

  const [day, month, suppliedYear] = parts;

  let year = referenceDate.getFullYear();

  if (suppliedYear) {
    year =
      suppliedYear < 100
        ? 2000 + suppliedYear
        : suppliedYear;
  }

  const parsedDate = new Date(year, month - 1, day);

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate;
}

function getStartOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();

  /*
    Convert Sunday-based JavaScript weekdays into Monday-based weeks.
  */
  const difference = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + difference);
  result.setHours(0, 0, 0, 0);

  return result;
}

function getEndOfWeek(date) {
  const result = getStartOfWeek(date);

  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);

  return result;
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatFullDisplayDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function buildCurrentWeekGroups(datedItems) {
  const today = new Date();
  const weekStart = getStartOfWeek(today);
  const weekEnd = getEndOfWeek(today);

  const dateMap = new Map();

  datedItems.forEach(({ shortage, salesOrder, date }) => {
    const parsedDate = parseShortDate(date, today);

    if (!parsedDate) {
      return;
    }

    if (parsedDate < weekStart || parsedDate > weekEnd) {
      return;
    }

    const dateKey = [
      parsedDate.getFullYear(),
      String(parsedDate.getMonth() + 1).padStart(2, "0"),
      String(parsedDate.getDate()).padStart(2, "0"),
    ].join("-");

    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, {
        date: parsedDate,
        shortages: new Map(),
      });
    }

    const group = dateMap.get(dateKey);

    if (!group.shortages.has(shortage)) {
      group.shortages.set(shortage, new Set());
    }

    group.shortages.get(shortage).add(salesOrder);
  });

  return {
    weekStart,
    weekEnd,

    groups: Array.from(dateMap.values())
      .sort((a, b) => a.date - b.date)
      .map((group) => ({
        date: group.date,

        shortages: Array.from(group.shortages.entries())
          .map(([shortage, orders]) => ({
            shortage,
            orders: Array.from(orders).sort(),
          }))
          .sort((a, b) =>
            a.shortage.localeCompare(b.shortage)
          ),
      })),
  };
}

function App() {
  const [tbcShortages, setTbcShortages] = useState([]);
  const [input, setInput] = useState("");
  const [results, setResults] = useState([]);
  const [datedItems, setDatedItems] = useState([]);
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
        result.orders.some((order) =>
          order.includes(searchTerm)
        )
    );
  }, [results, search]);

  const currentWeek = useMemo(
    () => buildCurrentWeekGroups(datedItems),
    [datedItems]
  );

  function handleScrape() {
    if (!input.trim()) {
      setResults([]);
      setDatedItems([]);
      setMessage("Paste the Excel data before scraping.");
      return;
    }

    const parsed = parseShortages(input);

    setResults(parsed.shortages);
    setDatedItems(parsed.datedItems);
    setTbcShortages(parsed.tbcShortages);

    setMessage(
      parsed.shortages.length
        ? `Found ${parsed.shortages.length} unique shortages.`
        : "No shortage rows were found."
    );
  }

  function handleClear() {
    setInput("");
    setResults([]);
    setDatedItems([]);
    setTbcShortages([]);
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
            Copy the rows from Excel, paste them below and group each
            shortage by sales order.
          </p>
        </header>

        <section className="panel">
          <label htmlFor="excel-data">Paste Excel data</label>

          <textarea
            id="excel-data"
            value={input}
            onChange={(event) =>
              setInput(event.target.value)
            }
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

          {message && (
            <p className="message">{message}</p>
          )}
        </section>

        {results.length > 0 && (
          <>
            <section className="panel weekly-panel">
              <div className="weekly-header">
                <div>
                  <p className="eyebrow">
                    Current production week
                  </p>

                  <h2>Shortages dated for this week</h2>

                  <p>
                    {formatFullDisplayDate(
                      currentWeek.weekStart
                    )}{" "}
                    to{" "}
                    {formatFullDisplayDate(
                      currentWeek.weekEnd
                    )}
                  </p>
                </div>
              </div>

              {currentWeek.groups.length > 0 ? (
                <div className="weekly-groups">
                  {currentWeek.groups.map((group) => (
                    <article
                      className="weekly-date-group"
                      key={group.date.toISOString()}
                    >
                      <div className="weekly-date">
                        <span>
                          {formatDisplayDate(group.date)}
                        </span>

                        <small>
                          {new Intl.DateTimeFormat("en-GB", {
                            weekday: "long",
                          }).format(group.date)}
                        </small>
                      </div>

                      <div className="weekly-shortages">
                        {group.shortages.map((item) => (
                          <div
                            className="weekly-shortage-row"
                            key={item.shortage}
                          >
                            <span className="shortage-code">
                              {item.shortage}
                            </span>

                            <span className="weekly-orders">
                              {item.orders.join(", ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-week">
                  No shortages are dated for the current
                  week.
                </p>
              )}
            </section>
            
              <section className="panel tbc-panel">
              <div className="tbc-header">
                <div>
                  <p className="eyebrow">Awaiting confirmation</p>

                  <h2>TBC shortages</h2>

                  <p>
                    {tbcShortages.length} component
                    {tbcShortages.length === 1 ? "" : "s"} currently marked
                    as TBC
                  </p>
                </div>
              </div>

              {tbcShortages.length > 0 ? (
                <div className="tbc-list">
                  {tbcShortages.map((item) => (
                    <div className="tbc-row" key={item.shortage}>
                      <span className="shortage-code">
                        {item.shortage}
                      </span>

                      <span className="tbc-orders">
                        {item.orders.join(", ")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-tbc">
                  No shortages are currently marked as TBC.
                </p>
              )}
            </section>

            <section className="panel results-panel">
              <div className="results-header">
                <div>
                  <h2>All shortage results</h2>

                  <p>
                    {results.length} unique component codes
                  </p>
                </div>

                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
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

                        <td>
                          {result.orders.join(", ")}
                        </td>

                        <td>
                          {result.orders.length}
                        </td>
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
          </>
        )}
      </section>
    </main>
  );
}

export default App;