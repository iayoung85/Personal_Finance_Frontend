// ============================================================
// categories/state.js — Shared UI/Data State
// Single source of truth for all mutable state used across
// category page modules. Loaded first via <script> tag.
// ============================================================

// Core data objects — populated by api.js on page load
let categoryMappings = {};
let customCategories = [];
// Labels the app owns, from the GET's locked_labels: [{label, mapping_key, reason, message}]
let lockedLabels = [];
// Labels that are Plaid's own name for a key mapped to them, from the GET's plaid_named_labels
let plaidNamedLabels = [];
let availableCategories = [];
let categoryListHash = null;
let rules = [];
let plaidTaxonomy = [];
let migrationLog = [];
let overrides = []; // Overrides summary: [{category_name, transaction_count}]

// How each primary counts: the GET's primary_categories, or null when the API sends none
let primaryCategories = null;

// One entry per listed label, from the GET's labels: the Categories table's rows
let categoryLabels = [];
// True when the API answered without labels (an API older than the table)
let categoryLabelsMissing = false;
// True when the last try at loading the category list failed, so the table
// offers Retry instead of reading as an empty list.
let categoryLoadFailed = false;

// Normalized names of pinned primaries whose explanation is open, so a redraw keeps it open.
const pinnedNotesOpen = new Set();

// Account list for account-scoped rules — [{account_id, display_name}]
let ruleAccountOptions = [];

// Primary mapping state — derived from detailed mappings
let primaryCategoryMappings = {};

// Rule editing state
let currentRuleEditId = null;

// Detailed-mappings list filter
let selectedDetailedPrimaryFilter = '__all__';

// Categories table: primaries the user folded (every primary opens expanded),
// the selected category labels with the Shift-click anchor, and the primary
// row selected by itself, which never joins a Merge.
const collapsedPrimaries = new Set();
let categorySelection = { labels: [], anchor: null };
let selectedPrimaryRow = null;

// Categories table view: sort, search text and filter. Kept here, not in storage,
// so they outlive the reload after a change and start fresh with the page.
let categoryViewState = { sortColumn: 'name', sortDirection: 'asc', searchText: '', filter: 'all' };

// Auth state
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// Status message auto-dismiss timer
let statusTimeout;

// ── Cache Keys & TTLs ──────────────────────────────────────
const CAT_PAGE_CACHE_KEY = 'pf_catpage_data';
const CAT_PAGE_CACHE_TS_KEY = 'pf_catpage_cached_at';
const CAT_PAGE_CACHE_MAX_AGE_MS = 10 * 1000; // 10 seconds — kept ultra-short during development to avoid stale-data confusion
const CAT_PAGE_TAXONOMY_KEY = 'pf_catpage_taxonomy';
const CAT_PAGE_TAXONOMY_TS_KEY = 'pf_catpage_taxonomy_at';
const CAT_PAGE_TAXONOMY_MAX_AGE_MS = 10 * 1000; // 10 seconds — kept ultra-short during development
