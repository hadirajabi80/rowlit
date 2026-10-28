import { extendContextMenu } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { registerTabView } from '../layout/tabViews';
import { monitorContext, MONITOR_VIEW, openMonitor } from './open';
import { MonitorTab } from './views';

export const MONITOR_COMMANDS: Command<never>[] = [{
  id: 'monitor.open', title: 'Server monitor', category: 'Database', shortcut: 'Mod+Alt+M', icon: 'Gauge',
  keywords: 'server monitor dashboard metrics performance sessions cache throughput database size uptime',
  when: (a?: unknown) => !!monitorContext(a), run: (a?: unknown) => { const c = monitorContext(a); if (c) openMonitor(c); },
}];

let registered = false;
export function registerMonitorCommands() {
  if (registered) return; registered = true;
  registerTabView(MONITOR_VIEW, { component: MonitorTab, icon: 'Gauge' });
  registerCommands(MONITOR_COMMANDS);
  extendContextMenu('explorer.connection', [{ command: 'monitor.open', optional: true, hideDisabled: true }]);
}
