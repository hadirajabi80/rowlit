import { extendContextMenu } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { registerTabView } from '../layout/tabViews';
import { openSecurity, securityContext, SECURITY_VIEW } from './open';
import { SecurityTab } from './views';

export const SECURITY_COMMANDS: Command<never>[] = [{
  id: 'security.open', title: 'Users, roles and privileges', category: 'Database', icon: 'ShieldCheck',
  keywords: 'security users logins roles privileges grants permissions',
  when: (a?: unknown) => !!securityContext(a), run: (a?: unknown) => { const c = securityContext(a); if (c) openSecurity(c); },
}];
let registered = false;
export function registerSecurityCommands() {
  if (registered) return; registered = true;
  registerTabView(SECURITY_VIEW, { component: SecurityTab, icon: 'ShieldCheck' });
  registerCommands(SECURITY_COMMANDS);
  extendContextMenu('explorer.connection', [{ command: 'security.open', optional: true, hideDisabled: true }]);
}
