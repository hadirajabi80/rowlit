# Export / import connections (WP-5) walkthrough

Manual checks for `File > Export connections…` / `Import connections…` (commands `connections.export`, `connections.import`).
Automated: `engine/tests/DbStudio.Core.Tests/Portability/ConnectionsPortabilityTests.cs`,
`ui/src/components/ConnectionsPanel/__tests__/portability.test.tsx`.

1. Create three connections: one in a folder with a password, one with an SSH tunnel (password auth, SSH password saved), one SQLite.
2. **Export, passwords off (default).** File > Export connections…: all ticked, "Include passwords" unticked. Save. Open the
   file in an editor: it is JSON, `"passwords": "none"`, no `secrets` block, the `ssh.*` props are present, no password text anywhere.
3. **Export, passwords on.** Tick "Include passwords". Export stays disabled until the passphrase has 8+ characters and matches
   the repeat. Save. The file has `"passwords": "encrypted"`, an `encryption` block (pbkdf2-sha256, aes-256-gcm) and a base64
   `secrets` string; searching the file for any password finds nothing.
4. **Folder shortcut.** Right-click a folder in the explorer > Export connections…: only that folder's connections are ticked.
5. **Import on a clean profile** (or after deleting the connections). File > Import connections…, pick the encrypted file. The
   table lists each connection with its action (Import as new), SSH and password markers.
   - Import without a passphrase: the connections appear, none has a password (connect asks for it).
   - Enter a wrong passphrase, Unlock: "Wrong passphrase, or the file was modified." and the table stays.
   - Enter the right one: "Unlocked". Import: the connections connect without asking for passwords, SSH password included.
6. **Update by name.** Import the same file again: rows that match an existing connection by name (case-insensitive) say
   `Replace "<name>"`; the id stays (open tabs keep working), a stored password is kept when the file has none. Switch a row to
   "Import as new": it arrives as `<name> (2)`. Switch to Skip: nothing happens for it.
7. **Bad files.** Import a random `.json`: "This is not a Rowlit connections file." A file from a future version: asks to update Rowlit.
8. Linked databases are never exported (the dialog says how many were left out).

Notes: key files (`ssh.keyPath`) and SQLite paths are exported as typed; fix them on the other machine. The passphrase is not
stored anywhere and cannot be recovered.
