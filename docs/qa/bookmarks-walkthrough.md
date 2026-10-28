# Editor bookmarks walkthrough

1. In a console, press **Ctrl+K, Ctrl+K** on several lines. Numbered glyphs appear in the editor margin.
2. Use **Ctrl+K, Ctrl+N** and **Ctrl+K, Ctrl+P** to move forward and backward, wrapping at the ends. The JetBrains/DataGrip keymap uses **F2** and **Shift+F2**.
3. Run **Bookmarks…** or press **Ctrl+K, Ctrl+L**. The list shows the console, line, and current line preview. Selecting one activates the console and reveals the line.
4. Edit text above a bookmark: the marker follows the edited line. Toggle the command on a marked line to remove it.
5. Close and reopen Rowlit with workspace restore enabled. The bookmark lines and list return with the console.

Automated coverage: `bookmarks.test.ts` checks normalization and the workspace serialization round trip; keymap preset tests cover the JetBrains bindings.
