// ============================================================
// transactions/state.js — Shared UI/Data State
// Single source of truth for all mutable state used across
// transaction page modules. Loaded first via <script> tag.
// ============================================================

// Core data arrays
let accounts = [];
let transactions = [];
let availableCategories = [];
let plaidTaxonomy = []; // Plaid PFCv2 category taxonomy for parsing

// Account selection state
let selectedAccountMode = 'all'; // 'all' or 'single'
let selectedAccountId = null; // The account_id when mode is not 'all'

// Category filter state
let filterPrimaryCategory = '';
let filterDetailedCategory = '';

// Auth state
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let idleTimeout;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// Chart state
let categoryChart = null;
let chartViewMode = 'primary'; // 'primary' or 'detailed'

// Pastel color palette for chart visualization
const PASTEL_COLORS = [
  '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#E0BBE4', '#FFDFD3', '#FEC8D8', '#D4F1F4', '#C9E4DE',
  '#F7D9C4', '#FAEDCB', '#C9F0DB', '#DBE7E4', '#F0EFEB',
  '#D5AAFF', '#FFCCE5', '#B4E7CE', '#FDE2E4', '#E2ECE9'
];

// Split transaction modal state
let currentSplitTransaction = null;
let splitRows = [];
let isEditingSplit = false;
