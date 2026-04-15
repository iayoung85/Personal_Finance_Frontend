// ============================================================
// bills/api.js — Backend Communication
// All network calls for the bills page. No DOM rendering
// here — just fetch, parse, return. Uses authenticatedFetch()
// and BACKEND_URL globals provided by config-helpers.js / config.js.
// ============================================================

async function fetchBills() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/?upcoming=10`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch bills');
  }
  const data = await response.json();
  return data.bills || [];
}

async function fetchBill(billId) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/${encodeURIComponent(billId)}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch bill');
  }
  return response.json();
}

async function fetchAccounts() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/banks?include_archived=false`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch accounts');
  }
  const data = await response.json();
  // Flatten banks → accounts with display names
  const flatAccounts = [];
  const config = typeof getAppConfig === 'function' ? getAppConfig() : {};
  const showMask = config.showMaskWithName !== false;
  (data.banks || []).forEach(bank => {
    const bankName = bank.bank_name || bank.custom_name || bank.institution_id || 'Bank';
    (bank.accounts || []).forEach(account => {
      const mask = account.effective_mask || account.user_mask || account.mask;
      let namePart = account.custom_name || account.account_name || 'Account';
      if (showMask && mask && !namePart.includes(mask)) {
        namePart = `${namePart} (${mask})`;
      }
      flatAccounts.push({
        account_id: account.account_id,
        display_name: `${bankName} - ${namePart}`,
        bank_name: bankName
      });
    });
  });
  return flatAccounts;
}

async function apiCreateBill(billData) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billData)
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create bill');
  }
  return response.json();
}

async function apiUpdateBill(billId, billData) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/${billId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billData)
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update bill');
  }
  return response.json();
}

async function apiDeleteBill(billId) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/${billId}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to delete bill');
  }
  return response.json();
}

async function apiToggleBill(billId) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/${billId}/toggle`, {
    method: 'PATCH'
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to toggle bill');
  }
  return response.json();
}
