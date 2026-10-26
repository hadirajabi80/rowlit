// WP-C fills this (plan-links 3): the links store — link catalogs (GET /links/{cid}/catalog, cached per link), builder
// tab models (per tab id, persisted in the tab state), the editor draft, linked views. Lazy: imported only by
// components/Links/** (never by the shell), so it stays out of the initial bundle.
export {};
