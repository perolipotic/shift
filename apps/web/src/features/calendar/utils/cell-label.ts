import { t } from '@/lib/i18n';
import type { CellLabelTranslate } from '@/features/calendar/utils/modifiers';

/**
 * The translator `@/features/calendar/utils/modifiers` builds a cell's full
 * label and a mark's name through: the one `t` the screen renders with, handed
 * to the pure vocabulary so the vocabulary itself imports no i18n. Shared by
 * the grid's labels, the day list's labels and the cell renderer.
 */
export const translateCellLabel: CellLabelTranslate = (key) => t(key);
