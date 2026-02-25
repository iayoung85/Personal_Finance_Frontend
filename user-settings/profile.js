// ============================================================
// user-settings/profile.js — Profile Details Panel
// Renders profile info and edit form. Email is read-only;
// changes must be made by the administrator.
// Network calls go through authenticatedFetch (api.js).
// ============================================================

/**
 * Loads and renders the read-only profile details view.
 * This is also the "reset" target after edit/cancel.
 */
async function loadProfileDetails() {
  const container = $('#profile-content');
  container.html('<div class="loading">Loading profile details...</div>');

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/profile-info`);
    const data = await response.json();

    if (!response.ok) {
      container.html(`<div class="message error">${data.error || 'Failed to load profile'}</div>`);
      return;
    }

    const html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Personal Information</h3>
        </div>
        <div class="form-group">
          <label>First Name</label>
          <input type="text" id="profile-first-name" value="${escapeHtml(data.first_name || '')}" disabled>
        </div>
        <div class="form-group">
          <label>Last Name</label>
          <input type="text" id="profile-last-name" value="${escapeHtml(data.last_name || '')}" disabled>
        </div>
        <div class="flex-group">
          <button class="btn btn-primary" onclick="editProfileMode()">Edit Details</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Email Address</h3>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" value="${escapeHtml(data.email)}" disabled>
        </div>
        <p class="text-muted">Email changes are handled by the administrator.</p>
      </div>

      <div id="profile-message"></div>
    `;

    container.html(html);
  } catch (error) {
    console.error('Error loading profile:', error);
    container.html(`<div class="message error">Connection error: ${error.message}</div>`);
  }
}

/**
 * Swaps the profile panel content to an editable form,
 * pre-populated with values from the read-only inputs.
 */
function editProfileMode() {
  const firstName = $('#profile-first-name').val();
  const lastName = $('#profile-last-name').val();

  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Edit Personal Information</h3>
      </div>
      <form id="edit-profile-form">
        <div class="form-group">
          <label for="edit-first-name">First Name</label>
          <input type="text" id="edit-first-name" value="${escapeHtml(firstName)}" required>
        </div>
        <div class="form-group">
          <label for="edit-last-name">Last Name</label>
          <input type="text" id="edit-last-name" value="${escapeHtml(lastName)}" required>
        </div>
        <div class="flex-group">
          <button type="submit" class="btn btn-primary">Save Changes</button>
          <button type="button" class="btn btn-secondary" onclick="loadProfileDetails()">Cancel</button>
        </div>
      </form>
      <div id="edit-profile-message"></div>
    </div>
  `;

  $('#profile-content').html(html);

  $('#edit-profile-form').on('submit', async function(e) {
    e.preventDefault();
    await updateProfileInfo();
  });
}

/**
 * Submits name changes to the backend and updates
 * the cached currentUser object in localStorage.
 */
async function updateProfileInfo() {
  const firstName = $('#edit-first-name').val().trim();
  const lastName = $('#edit-last-name').val().trim();

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/update-profile-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: firstName, last_name: lastName })
    });

    const data = await response.json();

    if (response.ok) {
      // Keep cached user object in sync with the update
      currentUser.first_name = firstName;
      currentUser.last_name = lastName;
      localStorage.setItem('currentUser', JSON.stringify(currentUser));

      showMessage('edit-profile-message', '✓ Profile updated successfully!', 'success');
      setTimeout(() => loadProfileDetails(), 1500);
    } else {
      showMessage('edit-profile-message', data.error || 'Failed to update profile', 'error');
    }
  } catch (error) {
    console.error('Error updating profile:', error);
    showMessage('edit-profile-message', `Connection error: ${error.message}`, 'error');
  }
}


