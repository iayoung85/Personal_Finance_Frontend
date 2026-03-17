// ============================================================
// investments/state.js — Shared UI/Data State
// Single source of truth for all mutable state used across
// investment page modules. Loaded first via <script> tag.
// ============================================================

// Core data arrays
let holdingsData = [];     // Per-item holdings blobs from backend
let securitiesData = [];   // Securities array from backend
let investmentAccounts = []; // Investment accounts (enriched with product status)
let accountStatus = [];    // Item-level status for sync-all logic

// Account selection state
let poolAllMode = true;           // When true, all holdings grouped by ticker
let selectedAccountIds = new Set(); // Individual account selections (used when poolAllMode is false)

// Auth state
let authToken = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch (_parseError) {
  currentUser = null;
}

// Sort state
let holdingsSortColumn = 'total_value';
let holdingsSortDirection = 'desc';

// Filter state
let filterSecurityType = '';  // e.g. 'equity', 'etf', 'mutual fund'
let filterSector = '';
let filterIndustry = '';

// Chart state
let investmentChart = null;
let chartViewMode = 'type'; // 'type', 'sector', or 'allocation'

// Vocabulary (populated from backend on page load)
let vocabularySectors = [];
let vocabularyIndustries = [];

// Allocation categories (populated from backend)
let allocationCategories = [];

// Pastel color palette (matches transactions chart)
const PASTEL_COLORS = [
  '#5B9BD5', '#ED7D72', '#70C1B3', '#F6BD60', '#A78BFA',
  '#FF8C42', '#4ECDC4', '#F87171', '#38BDF8', '#FBBF24',
  '#C084FC', '#34D399', '#FB923C', '#60A5FA', '#E879F9',
  '#2DD4BF', '#F472B6', '#818CF8', '#A3E635', '#FCA5A5'
];
