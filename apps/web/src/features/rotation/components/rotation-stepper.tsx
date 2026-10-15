import { Check, ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { rotationStepperStore } from '@/features/rotation/hooks/draft-store';
import type { RotationBuilder } from '@/features/rotation/hooks/use-rotation-builder';
import {
  STEPPER_STEPS,
  STEP_CURRENT,
  STEP_REACHED,
  STEP_UNREACHED,
  nextMessageKey,
  nextStepOf,
  previousStepOf,
  stepMessageKey,
  stepStatusOf,
} from '@/features/rotation/utils/stepper';
import { t } from '@/lib/i18n';

/**
 * The phone stepper's bar: the progress line, which takes focus on a step
 * change, and the four steps (story 2.4, UX-DR16; split out of
 * `RotationSection` by the epics 5–7 retro, A21). `sm:hidden`: CSS alone
 * switches it, never a width read in script.
 */
export function RotationStepBar({ builder }: { readonly builder: RotationBuilder }) {
  const { progress, stepper, moveStep } = builder;

  return (
    <div className="grid gap-3 sm:hidden">
      <p
        ref={progress}
        tabIndex={-1}
        className="scroll-mt-4 text-sm font-semibold text-muted-foreground focus-visible:outline-none"
      >
        {t('rotation.builder.stepper.progress', { current: stepper.current, total: STEPPER_STEPS.length })}
      </p>
      <nav aria-label={t('rotation.builder.stepper.label')}>
        <ol className="grid grid-cols-4 gap-1">
          {STEPPER_STEPS.map((step) => {
            const status = stepStatusOf(stepper, step);

            return (
              <li key={step} className="min-w-0">
                {/* THE STEP'S STATE IN WORDS AND A GLYPH, not colour alone:
                    the current one is `aria-current`, a reached one carries a
                    check and "završeno", an unreached one is disabled. */}
                <Button
                  type="button"
                  variant={status === STEP_CURRENT ? 'default' : 'outline'}
                  className="h-11 w-full flex-col gap-0 px-1 py-0 text-xs leading-tight"
                  aria-current={status === STEP_CURRENT ? 'step' : undefined}
                  disabled={status === STEP_UNREACHED}
                  onClick={() => {
                    moveStep(() => {
                      rotationStepperStore.set(step);
                    });
                  }}
                >
                  <span className="flex items-center gap-0.5 tabular-nums">
                    {status === STEP_REACHED ? <Check aria-hidden /> : null}
                    {step}
                  </span>
                  <span className="max-w-full truncate leading-normal">{t(stepMessageKey(step))}</span>
                  {status === STEP_REACHED ? (
                    <span className="sr-only">{t('rotation.builder.stepper.done')}</span>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

/** The phone stepper's Natrag and Dalje, `sm:hidden` as the bar is. */
export function RotationStepActions({ builder }: { readonly builder: RotationBuilder }) {
  const { stepper, moveStep } = builder;
  const previous = previousStepOf(stepper.current);
  const next = nextStepOf(stepper.current);

  return (
    <div className="flex flex-wrap gap-3 sm:hidden">
      {previous === null ? null : (
        <Button
          className="h-11 grow"
          type="button"
          variant="outline"
          onClick={() => {
            moveStep(() => {
              rotationStepperStore.back();
            });
          }}
        >
          <ChevronLeft aria-hidden />
          {t('rotation.builder.stepper.back')}
        </Button>
      )}
      {next === null ? null : (
        <Button
          className="h-11 grow"
          type="button"
          onClick={() => {
            moveStep(() => {
              rotationStepperStore.next();
            });
          }}
        >
          {t(nextMessageKey(next))}
        </Button>
      )}
    </div>
  );
}
