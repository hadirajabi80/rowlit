# Column statistics walkthrough

1. Open a table in a Data tab, right-click a column header, and choose **Column statistics…**. The dialog shows row and NULL counts, distinct values, range/average, top values, and a histogram for numeric or temporal data.
2. Apply a Data-tab filter and open the statistics again. The banner and counts describe only the filtered rows.
3. Profile a table with more than the exact-row safeguard. The result identifies the sample; **Cancel** stops the background job.
4. Run an ad hoc query, then use **Column statistics…** on a result column. The dialog explicitly says **Loaded rows only** and does not contact the server.
5. Repeat on a read-only connection. Profiling remains available because it only issues `SELECT` statements.

Automated coverage: `DbStudio.Stats.Tests` covers bounded/dialect SQL, histograms, read-only SQLite, and an end-to-end profile; `columnStats.test.ts` covers client aggregates.
