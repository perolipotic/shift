import { t } from '@/lib/i18n';
import {
  MESSAGE_SEPARATOR,
  memberWriteMessageKeys,
  type MemberWriteRefusal,
} from '@/features/members/services/write';

/**
 * What a member write refusal says on screen: every key
 * `memberWriteMessageKeys` pairs with it, translated and joined into one
 * sentence run. The pairing is the executed function's (`write.test.ts`); this
 * is only the one place the member forms turn its keys into text.
 */
export function refusalText(refusal: MemberWriteRefusal): string {
  return memberWriteMessageKeys(refusal)
    .map((key) => t(key))
    .join(MESSAGE_SEPARATOR);
}
