// Export / import of saved connections (auto-loaded by commands/index.ts):
//   connections.export   File ▸ Export connections… (also on a folder in the explorer): choose connections, optional encrypted passwords
//   connections.import   File ▸ Import connections…: read a .rowlit-connections.json, preview, import
// Both dialogs are a lazy chunk (./PortabilityHost); this module only registers the commands.
import { registerCommands, type Command } from '../../commands/registry';
import { useConnections } from '../../store/connections';

export const CONNECTIONS_PORTABILITY_COMMANDS: Command<never>[] = [
  {
    id: 'connections.export', title: 'Export connections…', category: 'Connections', icon: 'FileOutput',
    keywords: 'save share team file backup move machine json ssh passwords passphrase',
    when: () => useConnections.getState().connections.length > 0,
    // Args from a menu: a folder ({ folder }) or a connection ({ connectionId }) ticks just those.
    run: async (args?: unknown) => {
      const [{ showExportConnections }, { preselectionOf }] = await Promise.all([import('./PortabilityHost'), import('./portability')]);
      showExportConnections(preselectionOf(args, useConnections.getState().connections));
    },
  },
  {
    id: 'connections.import', title: 'Import connections…', category: 'Connections', icon: 'FileInput',
    keywords: 'open load team file restore move machine json ssh passwords passphrase',
    run: async () => (await import('./PortabilityHost')).showImportConnections(),
  },
];

export function registerConnectionsPortabilityCommands(): void {
  registerCommands(CONNECTIONS_PORTABILITY_COMMANDS);
}
