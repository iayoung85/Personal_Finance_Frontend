# personal_finance_frontend — the web client

The full web app for IAY Financial, served as static files at `bank.isaacyoung.com`. Vanilla JavaScript, HTML, and CSS. No framework, no bundler, no `package.json`, no build step: what is in the repo is what ships. jQuery, Chart.js, and Dexie come from a CDN.

The API is a separate repo. This client holds no business rules; it renders what the API returns. If a fix seems to need logic the phone app would also need, it belongs in the API — say so instead of writing it here.

Math over what is on screen is fine here. Summing, grouping, sorting, and formatting the rows the user is looking at is display work: it depends on filters and a local cache only this client has, and it saves nothing. Deciding what a transaction is, or whether it counts as spending, income, or a transfer, is a definition, and definitions belong to the API. The test: if two screens or the phone app show this number, must they agree? If yes, the API defines the rule and this client applies it to its own rows.

## Working alone or inside the workspace

This repo works by itself. It is also one of four that make up IAY Financial, normally checked out side by side inside a `Finance/` folder.

- **If `../_PLANS/` exists**, you are inside that workspace. Tracked work is planned and closed out from `Finance/`; a session started here does the work in this repo and leaves planning files and the changelog alone unless asked. Paths below that start with `../` point at sibling repos.
- **If it does not**, or you cannot read outside this folder, this repo is all you have. The API's documentation lives in the backend repo, so you cannot look up an endpoint's shape. Read how this repo's `api.js` files already call it, or curl the dev backend at `http://127.0.0.1:5501` if it is running, and ask the user rather than guess a field name.

## Commands

```bash
node --test tests/          # the whole suite, under a second
```

There is nothing to install. To see a page, serve this folder on port 5500 (5501 is the API) with the backend dev server running; the page finds it and signs in as the dev user by itself.

## How the code is laid out

Each page is `<page>.html` + `<page>.css` + a `<page>/` folder of scripts: `index`, `accounts`, `transactions`, `bills`, `categories`, `investments`, `user-settings`, `spending-alerts`. Within a page folder the files follow one pattern: `state.js` (page state), `api.js` (every call to the backend), `utils.js`, `main.js` (startup), then one file per feature.

Shared by every page, at the root: `config.js` (which backend to use), `config-helpers.js`, `date-helpers.js`, `nav-sidebar.js`, `theme.css`, `theme-loader.js`. Shared helpers and behavior used by more than one page go in `shared/`, for example `auth-session.js` and `modal-backdrop-guard.js`. Put new ones there, not at the root.

Much of the code is repeated across pages and features where one helper would do. Do not go looking to fold it up. But when a change would mean editing every copy of the same pattern anyway, write one helper in `shared/` and point the copies at it, instead of patching each one.

Things that are not obvious:

- **Scripts are plain `<script>` tags, not modules.** Everything is a global, and load order in the `.html` file is the dependency order. A new file must be added to the page's script list in the right place, and a new top-level name must not collide with one in another file on that page.
- **Wait for the backend address.** `config.js` decides the API address asynchronously. Code that calls the API awaits `window.BACKEND_URL_PROMISE` first.
- **Calls go through the page's `api.js`,** which adds the auth header and handles token refresh. Do not call `fetch` on the API from a feature file.
- **Transactions are cached in the browser.** `transactions/worker/db-worker.js` keeps a Dexie (IndexedDB) copy, reached through `transactions/worker-client.js`. After any edit, the local copy has to be patched to match what the server returned, or the page shows stale rows until the next full fetch.
- **`dev-tools.js` loads only against the dev backend.** It is the place for dev-only controls.
- **Transaction type names** are mirrored from the backend in `transactions/transaction-types.js`. They are defined by the backend; do not invent one here.

## Where to look

| Task | Read first |
| --- | --- |
| What a page is supposed to do | `../my_personal_finance/docs/page-blueprints/<page>.md` |
| What an endpoint takes and returns | `../my_personal_finance/docs/api-conventions.md` for the shared rules, then the route and the service it calls in `../my_personal_finance/src/modules/` |
| Colors, spacing, dark and light themes | `theme.css` — use its variables, do not hardcode colors |

Many files here are over a thousand lines. Search for the function, then read around it.

## Tests

`tests/*.test.js` use Node's built-in runner. Because the source files are browser globals, a test loads the file's text into a `vm` sandbox and pulls out the functions under test — copy the pattern from an existing test. Only pure functions can be tested this way, so keep logic worth testing out of DOM handlers. Anything visual needs the user to look at it; say so when you report.

## Conventions

- `camelCase` for functions and variables, `ALL_CAPS` for constants, a leading `_` for a helper used only inside its file.
- Readable over clever: descriptive names, no dense one-liners or nested ternaries.
- Comments say why, never what, and never mention a plan or an item code. JSDoc above functions for parameters and return types.
- Prefer plain JavaScript to adding a library.
