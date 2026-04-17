// ============================================================
// categories/state.js — Shared UI/Data State
// Single source of truth for all mutable state used across
// category page modules. Loaded first via <script> tag.
// ============================================================

// Core data objects — populated by api.js on page load
let categoryMappings = {};
let customCategories = [];
let availableCategories = [];
let categoryListHash = null;
let rules = [];
let plaidTaxonomy = [];
let migrationLog = [];
let overrides = []; // Overrides summary: [{category_name, transaction_count}]

// Account list for account-scoped rules — [{account_id, display_name}]
let ruleAccountOptions = [];

// Primary mapping state — derived from detailed mappings
let primaryCategoryMappings = {};

// Rule editing state
let currentRuleEditId = null;

// Preview panel selection state
let selectedPrimaryCategories = new Set(['__all__']);
let lastSelectedPrimaryIndex = null;
let selectedDetailedPrimaryFilter = '__all__';

// Custom categories preview selection state
let selectedCustomPrimaryCategories = new Set();
let lastSelectedCustomPrimaryIndex = null;

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
