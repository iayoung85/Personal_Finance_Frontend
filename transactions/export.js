// ============================================================
// transactions/export.js — Data Export Functions
// JSON export, CSV copy-to-clipboard, CSV download.
// ============================================================

function exportJSON() {
  const dataStr = JSON.stringify(transactions, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.json`;
  link.click();
}

// TODO: 2f: account balance summary for data exports.
// for a specific day like balance at end of day on last day of month. THIS IS A KEY DELIVERABLE- users want to be able to export a snapshot of their finances at month-end, not just raw transactions.
function copyCSV() {
  const csv = generateCSV();
  navigator.clipboard.writeText(csv).then(() => {
    showStatus('CSV copied to clipboard!', 'success');
    setTimeout(() => clearStatus(), 2000);
  }).catch(err => {
    showStatus('Failed to copy to clipboard', 'error');
  });
}

function downloadCSV() {
  const csv = generateCSV();
  const dataBlob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.csv`;
  link.click();
}

function generateCSV() {
  // Get selected optional fields
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });

  let csv = 'Date,Bank/Account,Description,Amount';
  
  // Add optional headers
  if (optionalFields.includes('merchant_name')) csv += ',Merchant';
  if (optionalFields.includes('category')) csv += ',Category (Primary),Category (Detailed),Confidence';
  if (optionalFields.includes('user_category')) csv += ',User Category';
  if (optionalFields.includes('payment_channel')) csv += ',Channel';
  if (optionalFields.includes('pending')) csv += ',Pending';
  if (optionalFields.includes('check_number')) csv += ',Check #';
  if (optionalFields.includes('original_description')) csv += ',Original Desc';
  if (optionalFields.includes('authorized_date')) csv += ',Auth Date';
  if (optionalFields.includes('authorized_datetime')) csv += ',Auth Time';
  
  csv += '\n';

  transactions.forEach(txn => {
    const dateObj = new Date(txn.date);
    const dateStr = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC'
    });
    const amount = txn.amount;
    const name = (txn.name || '').replace(/"/g, '""');
    
    csv += `"${dateStr}","${txn.bank_account}","${name}",${amount}`;
    
    // Add optional fields
    if (optionalFields.includes('merchant_name')) csv += `,"${(txn.merchant_name || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('category')) {
         // Use new personal_finance_category if available
         const pfc = txn.personal_finance_category;
         if (pfc) {
           const primaryRaw = (pfc.primary || '').replace(/_/g, ' ').trim();
           const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
           let detailedTrimmed = detailedRaw;
           if (primaryRaw && detailedRaw.toLowerCase().startsWith(primaryRaw.toLowerCase() + ' ')) {
             detailedTrimmed = detailedRaw.slice(primaryRaw.length).trim();
           } else {
             detailedTrimmed = detailedRaw.replace(/^\S+\s*/, '').trim();
           }
           const primary = primaryRaw.replace(/"/g, '""');
           const detailed = detailedTrimmed.replace(/"/g, '""');
           const confidence = (pfc.confidence_level || '').replace(/_/g, ' ').replace(/"/g, '""');
           csv += `,"${primary}","${detailed}","${confidence}"`;
         } else {
           // Fallback to legacy category
           let cat = txn.category;
           if (typeof cat === 'string' && cat.startsWith('{')) {
             cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
           } else if (Array.isArray(cat)) {
             cat = cat.join(', ');
           }
           csv += `,"${(cat || '').replace(/"/g, '""')}","",""`;
         }
    }
    if (optionalFields.includes('user_category')) csv += `,"${(txn.user_category || 'Uncategorized').replace(/"/g, '""')}"`;
    if (optionalFields.includes('payment_channel')) csv += `,"${(txn.payment_channel || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('pending')) csv += `,${txn.pending ? 'Yes' : 'No'}`;
    if (optionalFields.includes('check_number')) csv += `,"${(txn.check_number || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('original_description')) csv += `,"${(txn.original_description || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('authorized_date')) csv += `,"${(txn.authorized_date || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('authorized_datetime')) {
        let authTime = '';
        if (txn.authorized_datetime) {
            const dt = new Date(txn.authorized_datetime);
            authTime = dt.toLocaleString('en-US', {
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
        }
        csv += `,"${authTime}"`;
    }
    
    csv += '\n';
  });
  return csv;
}
