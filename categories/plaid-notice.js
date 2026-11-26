// ============================================================
// categories/plaid-notice.js — the notice for Plaid categories the
// user has not mapped, and where they answer each one.
//
// Depends on (loaded earlier): categories/plaid-answers.js,
//   categories/label-answers.js (buildInspectQuery, buildInspectLink),
//   categories/mappings.js (saveCategoryMappings, buildUnansweredLabelOptions)
// ============================================================

function renderPlaidCategoryNotice() {
  const notice = document.getElementById('plaid-category-notice');
  if (!notice) return;

  const entries = unansweredPlaidCategories || [];
  const catchAllLabel = catchAllState.label;
  if (categoryLoadFailed || entries.length === 0) {
    notice.hidden = true;
    notice.innerHTML = '';
    return;
  }

  const paragraphs = unansweredNoticeParagraphs(entries.length, catchAllLabel)
    .map(text => `<p>${escapeHtml(text)}</p>`)
    .join('');

  notice.innerHTML = `
    <div class="plaid-notice-head">
      <span class="plaid-notice-icon" aria-hidden="true"></span>
      <div class="plaid-notice-heading">
        <h2 id="plaid-notice-title">${escapeHtml(unansweredNoticeTitle(entries.length))}</h2>
        ${paragraphs}
      </div>
    </div>
    <ul class="plaid-notice-list">
      ${entries.map(entry => _plaidNoticeItemHTML(entry, catchAllLabel)).join('')}
    </ul>
  `;
  notice.hidden = false;
  _attachPlaidNoticeEvents(notice);
}

function _plaidNoticeItemHTML(entry, catchAllLabel) {
  const answer = plaidCategoryAnswers[entry.code];
  const pendingLabel = answer && answer.choice === PLAID_ANSWER_LABEL ? answer.label : '';
  const code = escapeHtml(entry.code);
  const name = escapeHtml(entry.name);
  const disabled = plaidNoticeSaving ? 'disabled' : '';

  let showLink = '';
  if (entry.transactions > 0 && catchAllLabel) {
    const link = buildInspectLink(buildInspectQuery(catchAllLabel, entry.code), entry.transactions);
    showLink = `<a class="plaid-notice-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener">Show them</a>`;
  }

  return `
      <li class="plaid-notice-item" data-plaid-code="${code}">
        <div class="plaid-notice-info">
          <div class="plaid-notice-name">${name}<code class="plaid-notice-code">${code}</code></div>
          <div class="plaid-notice-meta">${escapeHtml(describeRowsInCatchAll(entry.transactions, catchAllLabel))}${showLink}</div>
        </div>
        <div class="plaid-notice-choices" role="group" aria-label="Where ${name} goes">
          <div class="plaid-notice-choice">
            <span class="plaid-notice-choice-title">Move to a label</span>
            <div class="plaid-notice-choice-row">
              <select class="plaid-notice-select" aria-label="Label for ${name}" ${disabled}>
                ${buildUnansweredLabelOptions(entry, pendingLabel)}
              </select>
              <button type="button" class="cat-button cat-button-secondary plaid-notice-move" ${pendingLabel && !plaidNoticeSaving ? '' : 'disabled'}>Move</button>
            </div>
          </div>
          <div class="plaid-notice-choice">
            <span class="plaid-notice-choice-title">Leave them where they are</span>
            <div class="plaid-notice-choice-row">
              <button type="button" class="cat-button cat-button-secondary plaid-notice-keep" title="Keep in ${escapeHtml(catchAllLabel)}"
                      ${catchAllLabel && !plaidNoticeSaving ? '' : 'disabled'}>Keep in ${escapeHtml(catchAllLabel)}</button>
            </div>
          </div>
        </div>
      </li>`;
}

function _attachPlaidNoticeEvents(notice) {
  notice.querySelectorAll('.plaid-notice-item').forEach(item => {
    const code = item.getAttribute('data-plaid-code');
    const select = item.querySelector('.plaid-notice-select');
    const moveButton = item.querySelector('.plaid-notice-move');
    const keepButton = item.querySelector('.plaid-notice-keep');

    // Picking a label only arms Move, so a stray pick in the list saves nothing.
    select.addEventListener('change', () => {
      moveButton.disabled = plaidNoticeSaving || !select.value;
    });
    moveButton.addEventListener('click', () => {
      const label = (select.value || '').trim();
      if (!label) return;
      _saveNoticeAnswer(code, { choice: PLAID_ANSWER_LABEL, label }, moveButton);
    });
    keepButton.addEventListener('click', () => {
      _saveNoticeAnswer(code, { choice: PLAID_ANSWER_KEEP }, keepButton);
    });
  });
}

/**
 * Save one answer from the notice through the page's usual mappings save,
 * so its questions, confirmations and result message apply here too.
 */
async function _saveNoticeAnswer(code, answer, pressedButton) {
  if (plaidNoticeSaving) return;
  plaidCategoryAnswers[code] = answer;
  plaidNoticeSaving = true;
  document.querySelectorAll('#plaid-category-notice button, #plaid-category-notice select')
    .forEach(control => { control.disabled = true; });
  pressedButton.textContent = 'Saving…';
  try {
    await saveCategoryMappings();
  } finally {
    plaidNoticeSaving = false;
    renderPlaidCategoryNotice();
    renderMappingsList(document.getElementById('mapping-filter').value);
  }
}
