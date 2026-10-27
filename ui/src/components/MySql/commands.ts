// MySQL / MariaDB: the table designer's options row (ENGINE, CHARSET, COLLATION, ROW_FORMAT, AUTO_INCREMENT).
import { lazy } from 'react';
import { registerDesignerOptionsPanel } from '../../designer/table/optionsPanels';

export function registerMySqlCommands(): void {
  const panel = lazy(() => import('./TableOptions'));
  registerDesignerOptionsPanel('mysql', panel);
  registerDesignerOptionsPanel('mariadb', panel);
}
