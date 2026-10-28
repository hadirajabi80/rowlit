// Data Transfer commands (auto-loaded by commands/index.ts). Tiny: the wizard is a lazy chunk (./views.tsx).
//   transfer.open  "Transfer data…"       explorer tables / views (multi-selection = pre-ticked), schema / database /
//                                         connection, the Database menu, the palette
//   transfer.dump  "Dump to SQL file…"    the same, with "SQL file" as the target (a portable backup script)
import { extendContextMenu } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { registerTabView } from '../layout/tabViews';
import { openTransfer, transferContext, TRANSFER_VIEW_ID } from './open';
import { TransferTab } from './views';

const KEYWORDS = 'transfer copy migrate tables data between connections servers databases navicat datagrip dbeaver';

export const TRANSFER_COMMANDS: Command<never>[] = [
  {
    id: 'transfer.open', title: 'Transfer data…', category: 'Database', icon: 'ArrowRightLeft', keywords: KEYWORDS,
    when: (args?: unknown) => !!transferContext(args),
    run: (args?: unknown) => {
      const ctx = transferContext(args);
      if (ctx) openTransfer(ctx);
    },
  },
  {
    id: 'transfer.dump', title: 'Dump to SQL file…', category: 'Database', icon: 'FileCode2', keywords: 'dump backup export sql script insert create',
    when: (args?: unknown) => !!transferContext(args),
    run: (args?: unknown) => {
      const ctx = transferContext(args);
      if (ctx) openTransfer({ ...ctx, dump: true });
    },
  },
];

let registered = false;

export function registerTransferCommands(): void {
  if (registered) return;
  registered = true;
  registerTabView(TRANSFER_VIEW_ID, { component: TransferTab, icon: 'ArrowRightLeft' });
  registerCommands(TRANSFER_COMMANDS);
  const entries = [
    { command: 'transfer.open', optional: true, hideDisabled: true },
    { command: 'transfer.dump', optional: true, hideDisabled: true },
  ];
  for (const menu of ['explorer.table', 'explorer.view', 'explorer.container', 'explorer.connection']) extendContextMenu(menu, entries);
}
