# Excel add-in

A task pane for the budget workbook. It fetches the account-balance and category-summary reports for a month range, writes them to `PF_BALANCES` and `MYAPP Categories` in the layout the web client's report copy produces, and writes what the workbook's lookups will miss to `PF_CHECK`. It can also paste either report at the selected cell. It never writes to the `Accounts` or `Categories` sheets.

Two manifests, the same panel:

| File | Panel served from | API | Name in Excel |
| --- | --- | --- | --- |
| `manifest.xml` | `https://bank.isaacyoung.com/excel/` | live | IAY Financial |
| `manifest-dev.xml` | `http://localhost:5500/excel/` | dev | IAY Financial (dev) |

Each has its own Id, so both can be installed at once. The dev panel needs this folder served on port 5500 and the dev API running; it signs in as the dev user by itself. The live panel shows a sign-in form the first time.

## Mac

1. Create the folder if it is missing: `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef`
2. Copy the manifest into it.
3. Quit and reopen Excel, open the workbook, then Home > Add-ins and pick it from the developer add-ins. The Home tab also gets a Reports button.

## Windows

1. Put the manifest in a folder and share it on the network (its `\\machine\share` path).
2. In Excel: File > Options > Trust Center > Trust Center Settings > Trusted Add-in Catalogs. Add the share path as a catalog URL, tick Show in Menu, and save.
3. Restart Excel, then Home > Add-ins > More Add-ins > Shared Folder, and add it.

## Updating

The panel is plain files in this folder, loaded each time it opens: a push to the live site updates the live panel. Change a manifest only to change its name, icon or address, and then copy it in again.
