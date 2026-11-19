// ============================================================
// transactions/insights.js — Insights Panel Rendering
// Uses the shared analytics slice so the cards stay aligned with
// the currently visible ledger rows.
// ============================================================

// Where the custom cards are set up; App configuration opens on this hash.
const INSIGHT_CARD_SETTINGS_URL = 'user-settings.html#app-config';

const INSIGHT_CARD_FILTER_TITLE = 'Show the transactions this card counts';

/**
 * A card amount, masked when privacy mode is on. Only the cards go through
 * here; the category summary modal keeps the plain formatter.
 * @param {number} amount
 * @returns {string}
 */
function _insightMoney(amount) {
  return maskMoney(formatAnalyticsCurrency(amount));
}

/**
 * The count line every card shows, worded the same on each.
 * @param {number} count
 * @returns {string} "1 transaction" or "N transactions".
 */
function insightCountText(count) {
  const safeCount = Number(count) || 0;
  return safeCount === 1 ? '1 transaction' : `${safeCount} transactions`;
}

/**
 * Money out of a group of spending or savings entries, as a positive number.
 * Adding 0 turns a negative zero into zero so an empty side reads $0.00.
 * @param {Array<{amount: number}>} entries
 * @returns {number}
 */
function _insightOutflowAmount(entries) {
  const rawTotal = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return getAnalyticsDisplayAmount(rawTotal, ANALYTICS_DISPLAY_MODE.SPENDING) + 0;
}

// Spending plus savings: the same two classes the API adds into Total outflow.
function _buildTotalOutflowInsight(analyticsView) {
  return {
    label: 'Total Outflow',
    value: _insightMoney(_insightOutflowAmount(analyticsView.outflowEntries)),
    countText: insightCountText(analyticsView.outflowEntries.length),
    details: {
      paragraphs: ['Spending plus savings in the current view.'],
      rows: [
        { label: 'Spending', value: _insightMoney(_insightOutflowAmount(analyticsView.spendingEntries)) },
        { label: 'Savings', value: _insightMoney(_insightOutflowAmount(analyticsView.savingsEntries)) },
      ],
    },
  };
}

/**
 * The categories a custom card is set to, whole primaries first.
 * @param {{primaries: string[], details: string[]}} card
 * @returns {string[]}
 */
function _insightCardCategoryList(card) {
  return [...(card.primaries || []), ...(card.details || [])];
}

/**
 * One insights-bar card for a user-named group of categories.
 * @param {{name: string, primaries: string[], details: string[]}} card
 * @param {Object} analyticsView The slice from buildNormalizedAnalyticsSlice().
 * @returns {Object} Insight card view model.
 */
function _buildInsightCardInsight(card, analyticsView) {
  const matchingEntries = filterEntriesForInsightCard(analyticsView.trackableEntries, card);
  const rawTotal = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const averageRows = getInsightCardAverageLines(matchingEntries).map(line => ({
    label: line.label,
    value: line.amount === null ? '—' : _insightMoney(line.amount),
  }));
  const flow = getInsightCardFlowSummary(matchingEntries);
  const details = {
    rows: averageRows,
    listTitle: 'Categories',
    list: _insightCardCategoryList(card),
    link: { href: INSIGHT_CARD_SETTINGS_URL, text: 'Change in App configuration' },
  };

  // A custom card narrows the ledger to the rows it counts when pressed.
  const filterFields = { filterCardName: card.name, title: INSIGHT_CARD_FILTER_TITLE };

  if (flow.isMixed) {
    // Why: an unsigned total on a card holding both sides cannot say which
    // side is bigger, so it shows a signed net and both sides in its details.
    const signedNet = getAnalyticsSignedDisplay(rawTotal, ANALYTICS_DISPLAY_MODE.INCOME);
    details.rows = [
      { label: 'In', value: _insightMoney(flow.inTotal) },
      { label: 'Out', value: _insightMoney(flow.outTotal) },
      ...averageRows,
    ];
    return {
      label: card.name,
      value: maskMoney(signedNet.text),
      valueTone: signedNet.tone,
      countText: insightCountText(matchingEntries.length),
      details,
      ...filterFields,
    };
  }

  return {
    label: card.name,
    value: _insightMoney(getAnalyticsDisplayTotal(rawTotal, matchingEntries)),
    countText: insightCountText(matchingEntries.length),
    details,
    ...filterFields,
  };
}

function _buildLiveLedgerInsight(analyticsView) {
  const ledgerNetAmount = analyticsView.ledgerEntries.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    label: 'Live Result',
    value: _insightMoney(ledgerNetAmount),
    countText: insightCountText(analyticsView.ledgerEntries.length),
    details: {
      paragraphs: ['Signed net sum of the current ledger view.'],
    },
  };
}

/**
 * The Category Summary card's third line: how many primary categories its
 * table lists. A transaction count here would sit beside Live Result's and
 * differ from it for every transfer and adjustment the table leaves out.
 * @param {Array<Object>} summaryEntries The rows the category table covers.
 * @returns {string}
 */
function insightCategoryCountText(summaryEntries) {
  const entriesByPrimary = new Map();
  summaryEntries.forEach(entry => {
    const primary = entry.primary_category || 'Uncategorized';
    if (!entriesByPrimary.has(primary)) {
      entriesByPrimary.set(primary, []);
    }
    entriesByPrimary.get(primary).push(entry);
  });

  // A primary shown only as a stat card has no row in the table's grid.
  let categoryCount = 0;
  entriesByPrimary.forEach(entries => {
    if (!isStatCardOnlyEntries(entries)) {
      categoryCount += 1;
    }
  });

  return categoryCount === 1 ? '1 primary category' : `${categoryCount} primary categories`;
}

function _buildCategorySummaryInsight(analyticsView) {
  const coveredCount = analyticsView.summaryEntries.length;
  const listedCount = analyticsView.ledgerEntries.length;

  return {
    label: 'Category Summary',
    value: 'Open category table',
    countText: insightCategoryCountText(analyticsView.summaryEntries),
    details: {
      paragraphs: [
        'Spending, savings, income, other inflow, investment trend and retirement income in the current view, grouped by category.',
        `${coveredCount} of the ${listedCount} listed transactions. Transfers, adjustments and balance anchors are left out.`,
      ],
    },
    cardClass: ' insight-summary-card',
    title: 'Open category summary table',
    onClick: '_onCategorySummaryCardClick(event)',
  };
}

/**
 * Whether the search is narrowed to one of the user's cards. A card filter
 * that lists nothing must still show the row, or the pressed card that put
 * the filter on would not be there to take it off.
 * @param {Array<{name: string}>} insightCards The user's custom cards.
 * @returns {boolean}
 */
function _isInsightCardFilterInSearch(insightCards) {
  return insightCards.some(card => isCardTermInSearch(searchQuery, card.name));
}

function generateSpendingInsights() {
  const analyticsView = buildNormalizedAnalyticsSlice();

  if (!analyticsView.ledgerEntries.length && !_isInsightCardFilterInSearch(analyticsView.insightCards)) {
    return null;
  }

  const insights = [_buildTotalOutflowInsight(analyticsView)];

  analyticsView.insightCards.forEach(card => {
    insights.push(_buildInsightCardInsight(card, analyticsView));
  });

  insights.push(_buildLiveLedgerInsight(analyticsView));
  insights.push(_buildCategorySummaryInsight(analyticsView));

  return insights;
}

/**
 * The inside of a card's details popover.
 * @param {{paragraphs?: string[], rows?: Array<{label: string, value: string}>,
 *   listTitle?: string, list?: string[], link?: {href: string, text: string}}} details
 * @returns {string} HTML.
 */
function _renderInsightDetails(details) {
  const paragraphsHtml = (details.paragraphs || [])
    .map(text => `<p class="insight-popover-text">${escapeHtml(text)}</p>`)
    .join('');

  const rows = details.rows || [];
  const rowsHtml = rows.length
    ? `<dl class="insight-popover-rows">${rows.map(row => `
        <div class="insight-popover-row">
          <dt>${escapeHtml(row.label)}</dt>
          <dd>${escapeHtml(row.value)}</dd>
        </div>`).join('')}
      </dl>`
    : '';

  const list = details.list || [];
  const listHtml = list.length
    ? `<div class="insight-popover-section-title">${escapeHtml(details.listTitle || '')}</div>
      <ul class="insight-popover-list">${list.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '';

  const linkHtml = details.link
    ? `<a class="insight-popover-link" href="${escapeHtml(details.link.href)}">${escapeHtml(details.link.text)}</a>`
    : '';

  return `${paragraphsHtml}${rowsHtml}${listHtml}${linkHtml}`;
}

/**
 * One card: name, number, count, each on a single line, and an info button
 * that discloses the card's details when it has any.
 * @param {Object} insight Card view model.
 * @param {number} index Position in the row, for the popover's id.
 * @returns {string} HTML.
 */
function _renderInsightCard(insight, index) {
  const isFilterCard = insight.filterCardName !== undefined;
  const isFilterActive = isFilterCard && isCardTermInSearch(searchQuery, insight.filterCardName);
  let clickAttrs = '';
  if (insight.onClick) {
    clickAttrs = ` onclick="${insight.onClick}" role="button" tabindex="0"`;
  } else if (isFilterCard) {
    clickAttrs = ` onclick="_onInsightFilterCardClick(event)" role="button" tabindex="0"`
      + ` aria-pressed="${isFilterActive}" data-insight-card-name="${escapeHtml(insight.filterCardName)}"`;
  }
  const cardTitle = insight.title ? ` title="${escapeHtml(insight.title)}"` : '';
  const label = escapeHtml(insight.label);
  const popoverId = `insight-details-${index}`;
  // The button and popover carry their own title so a clickable card's
  // tooltip ("Open category summary table") does not show over them.
  const detailsHtml = insight.details
    ? `
      <button type="button" class="insight-info-btn" aria-label="Details for ${label}" title="Details"
              aria-expanded="false" aria-controls="${popoverId}">i</button>
      <div class="insight-popover" id="${popoverId}" title="" hidden>${_renderInsightDetails(insight.details)}</div>`
    : '';

  // The full name rides in a tooltip for when the line truncates it, unless
  // the card already has a tooltip of its own. A filter card keeps it: its
  // name is the one thing its card-wide tooltip does not say.
  const labelTitle = insight.title && !isFilterCard ? '' : ` title="${label}"`;
  const cardClass = `${insight.cardClass || ''}${isFilterCard ? ' insight-filter-card' : ''}`;

  return `
    <div class="insight-card${cardClass}"${clickAttrs}${cardTitle}>
      <div class="insight-label"${labelTitle}>${label}</div>
      <div class="insight-value${insight.valueTone ? ` tone-${insight.valueTone}` : ''}">${escapeHtml(insight.value)}</div>
      <div class="insight-meta">${escapeHtml(insight.countText)}</div>${detailsHtml}
    </div>
  `;
}

// ── Details popover ────────────────────────────────────────────
// One popover open at a time. The panel is redrawn on every table render,
// which closes any open popover; the listeners below are registered once, at
// load, and find the open popover in the page, so a redraw leaks nothing.

function _findOpenInsightPopover() {
  return document.querySelector('.insight-popover:not([hidden])');
}

/**
 * Closes the open details popover, if any.
 * @param {boolean} restoreFocus True returns focus to its info button.
 */
function _closeInsightDetails(restoreFocus) {
  const popover = _findOpenInsightPopover();
  if (!popover) return;

  popover.hidden = true;
  popover.classList.remove('align-end');
  const button = document.querySelector(`.insight-info-btn[aria-controls="${popover.id}"]`);
  if (!button) return;
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button.focus();
}

function _toggleInsightDetails(button) {
  const popover = document.getElementById(button.getAttribute('aria-controls'));
  if (!popover) return;

  const wasOpen = !popover.hidden;
  _closeInsightDetails(false);
  if (wasOpen) return;

  popover.hidden = false;
  button.setAttribute('aria-expanded', 'true');

  // A popover hanging off a card near the right edge would be cut off by the
  // page, so it opens leftward from that card instead.
  const panel = popover.closest('.insights-panel');
  if (panel && popover.getBoundingClientRect().right > panel.getBoundingClientRect().right) {
    popover.classList.add('align-end');
  }
}

/**
 * Whether a press landed on a card's info button or inside its open details,
 * which belong to the details and never to the card's own action.
 * @param {Event} event
 * @returns {boolean}
 */
function _isPressInsideInsightDetails(event) {
  const target = event && event.target;
  return !!(target && target.closest && target.closest('.insight-info-btn, .insight-popover'));
}

/**
 * The Category Summary card opens its table, except when the press was on its
 * info button or inside its open details.
 * @param {MouseEvent} event
 */
function _onCategorySummaryCardClick(event) {
  if (_isPressInsideInsightDetails(event)) {
    return;
  }
  toggleCategorySummaryModal();
}

/**
 * Toggle a custom card's filter. Applying the search redraws the whole card
 * row, which would drop keyboard focus, so focus goes back to the same card.
 * @param {HTMLElement} cardElement The card that was pressed.
 */
function _toggleInsightCardFilter(cardElement) {
  const cardName = cardElement.getAttribute('data-insight-card-name');
  if (cardName === null) {
    return;
  }

  const hadFocus = document.activeElement === cardElement;
  toggleCardSearchFilter(cardName);
  if (!hadFocus) {
    return;
  }

  const redrawn = Array.from(document.querySelectorAll('.insight-filter-card'))
    .find(card => card.getAttribute('data-insight-card-name') === cardName);
  if (redrawn) {
    redrawn.focus();
  }
}

/**
 * A custom card narrows the ledger to the rows it counts, except when the
 * press was on its info button or inside its open details.
 * @param {MouseEvent} event
 */
function _onInsightFilterCardClick(event) {
  if (_isPressInsideInsightDetails(event)) {
    return;
  }
  _toggleInsightCardFilter(event.currentTarget);
}

function _onInsightDetailsDocumentClick(event) {
  const target = event.target;
  if (!target || !target.closest) return;

  const button = target.closest('.insight-info-btn');
  if (button) {
    _toggleInsightDetails(button);
    return;
  }
  if (target.closest('.insight-popover')) return;
  _closeInsightDetails(false);
}

function _onInsightDetailsKeydown(event) {
  if (event.key === 'Escape' && _findOpenInsightPopover()) {
    _closeInsightDetails(true);
    return;
  }

  // Enter and Space press a focused custom card like a click. Only the card
  // itself: the info button inside it already acts on those keys.
  const target = event.target;
  const isPressKey = event.key === 'Enter' || event.key === ' ';
  if (isPressKey && !event.repeat && target && target.classList
    && target.classList.contains('insight-filter-card')) {
    event.preventDefault();
    _toggleInsightCardFilter(target);
  }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', _onInsightDetailsDocumentClick);
  document.addEventListener('keydown', _onInsightDetailsKeydown);
}

function renderInsightsPanel() {
  const container = document.getElementById('insights-container');
  if (!container) return;

  const insights = generateSpendingInsights();

  if (!insights || insights.length === 0) {
    container.innerHTML = '<div class="insights-empty">Select accounts and date range to view insights</div>';
    if (typeof renderCategorySummaryModal === 'function') {
      renderCategorySummaryModal();
    }
    return;
  }

  container.innerHTML = `
    <div class="insights-grid">
      ${insights.map((insight, index) => _renderInsightCard(insight, index)).join('')}
    </div>
  `;

  if (typeof renderCategorySummaryModal === 'function') {
    renderCategorySummaryModal();
  }
}
