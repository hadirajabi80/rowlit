// WP-D fills this (plan-links 3, "Materialize dialog"): links.materialize (from a linked console / the builder / a
// linked view: target connection, database/schema, table, mode create | replace | append, DDL preview through
// POST /links/{cid}/materialize/preview, job progress, "Open table") plus the "Add to link…" entries
// (extendContextMenu('explorer.table' | 'explorer.view' | the Objects tab menu) → links.addTable). Keep heavy code
// behind lazy(): this module is part of the links commands chunk.

/** Called from components/Links/commands.ts (block LINKS-WPD). */
export function registerMaterializeCommands(): void {
  // WP0 stub: nothing yet.
}
