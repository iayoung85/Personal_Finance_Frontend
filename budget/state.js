// ============================================================
// budget/state.js — Budget page state. Loaded first.
// ============================================================

let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = null;

// The last report the API sent, and whether a save has made it stale.
let budgetReport = null;
let budgetReportStale = true;
let budgetReportLoading = false;

// The GET /api/budget/targets body, kept as the saved state.
let budgetTargetsData = null;
let budgetTargetsLoading = false;
// The fiscal year the editor shows.
let budgetEditingYear = null;
// {fiscalYear: {key: text}}: each year's fields as the user left them,
// so switching years does not lose what was typed.
let budgetDrafts = {};
// {fiscalYear: {category, cadence, message}}: a refusal and where it goes.
let budgetRefusals = {};
let budgetSaving = false;
// Editor filters.
let budgetTargetsSearch = '';
let budgetTargetsOnlySet = false;
