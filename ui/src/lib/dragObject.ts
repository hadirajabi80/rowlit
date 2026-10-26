// plan-links WP0: what an explorer object row carries when it is dragged (the query builder canvas and the link editor
// accept drops of tables/views/columns; editors keep using text/plain and the older application/x-dbstudio-object).
import type { CatalogObjectType, ProviderId } from '../api/types';

/** Drag data type of an explorer object (JSON {@link RowlitObjectDrag}). */
export const ROWLIT_OBJECT_MIME = 'application/x-rowlit-object';

export interface RowlitObjectDrag {
  connectionId: string;
  providerId: ProviderId | string | null;
  /** Catalog database key (null for providers without a database level). */
  database: string | null;
  schema: string | null;
  name: string;
  type: CatalogObjectType;
  /** Set when a column row is dragged (name = its table). */
  column?: string | null;
}

/** The dragged object, or null when the drag carries none (or it is malformed). */
export function readObjectDrag(dt: Pick<DataTransfer, 'getData' | 'types'> | null | undefined): RowlitObjectDrag | null {
  if (!dt || !Array.from(dt.types ?? []).includes(ROWLIT_OBJECT_MIME)) return null;
  try {
    const v = JSON.parse(dt.getData(ROWLIT_OBJECT_MIME)) as Partial<RowlitObjectDrag>;
    return v && typeof v.connectionId === 'string' && typeof v.name === 'string' && typeof v.type === 'string' ? (v as RowlitObjectDrag) : null;
  } catch {
    return null;
  }
}
