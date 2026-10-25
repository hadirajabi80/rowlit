// Import Wizard tab: Source -> Format -> Target -> Columns -> Options -> Run, with a vertical stepper on the left (a progress
// bar on narrow tabs), one step at a time and a sticky footer (docs: Navicat's Import Wizard). The tab is lazy-loaded
// (./views.tsx); everything the shell needs at startup is in ./commands.ts and ./open.ts.
import { Check, ChevronLeft, ChevronRight, CircleAlert, Play } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { runCommand } from '../../commands/registry';
import { useUi } from '../../store/ui';
import type { TabViewProps } from '../layout/tabViews';
import { ColumnsStep } from './ColumnsStep';
import { FormatStep } from './FormatStep';
import { OptionsStep } from './OptionsStep';
import { RunStep } from './RunStep';
import { SourceStep } from './SourceStep';
import { TargetStep } from './TargetStep';
import { useWizard } from './useWizard';
import {
  STEP_COLUMNS, STEP_FORMAT, STEP_OPTIONS, STEP_RUN, STEP_SOURCE, STEP_SUMMARY, STEP_TARGET, STEPS,
} from './wizardState';
import './importWizard.css';

/** Elements that use Enter themselves (activate, new line, open): Enter there is never "Next". */
const OWN_ENTER = new Set(['BUTTON', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY']);

export function ImportWizardView({ tab, visible }: TabViewProps) {
  const w = useWizard(tab);
  const { s } = w;
  const step = s.step;
  const run = s.run;
  const finished = run.status === 'done';
  const locked = w.running || finished; // no navigation while the import runs or after it finished
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Focus management: a new step puts the focus on its heading (screen readers announce it) and scrolls to the top.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const idleRun = run.status === 'idle';
  const next = () => {
    if (step === STEP_RUN) void w.start();
    else w.goTo(step + 1);
  };
  const back = () => w.goTo(Math.max(STEP_SOURCE, step - 1));
  const closeTab = () => runCommand('tab.close', { kind: 'tab', tabId: tab.id });

  const requestClose = async () => {
    if (finished || !s.path.trim()) {
      closeTab();
      return;
    }
    const ok = await useUi.getState().askConfirm({
      title: 'Close the import?', message: 'The file and the options you chose in this wizard are discarded. Nothing has been imported.',
      confirmLabel: 'Close', cancelLabel: 'Keep editing',
    });
    if (ok) closeTab();
  };

  const requestCancel = async () => {
    const ok = await useUi.getState().askConfirm({
      title: 'Cancel the import?', message: 'The import stops. Rows that are already committed stay unless the import runs in one transaction.',
      confirmLabel: 'Cancel import', cancelLabel: 'Keep importing', danger: true,
    });
    if (ok) void w.cancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (OWN_ENTER.has(el.tagName) || el.isContentEditable || el.closest('pre,[role="listbox"],[role="combobox"]')) return;
      if (step < STEP_RUN && w.canNext[step] && !locked) {
        e.preventDefault();
        next();
      }
    } else if (e.key === 'Escape') {
      if (el.tagName === 'SELECT' || el.closest('[aria-expanded="true"]')) return;
      e.preventDefault();
      if (w.running) void requestCancel();
      else void requestClose();
    }
  };

  const hint = step <= STEP_RUN && !w.running && !finished && idleRun ? w.nextHint(step) : null;
  const stepState = (i: number): 'current' | 'done' | 'error' | 'todo' => {
    if (i === step) return 'current';
    if (i < step) return w.canNext[i] || (i === STEP_RUN) ? 'done' : 'error';
    return 'todo';
  };

  return (
    <div className="iw" data-testid="import-wizard" style={{ display: visible ? undefined : 'none' }} data-command-scope="importWizard" onKeyDown={onKeyDown}>
      <div className="iw-shell">
        <nav className="iw-side" aria-label="Import progress">
          <ol className="iw-steps" aria-label="Import steps">
            {STEPS.map((name, i) => {
              const state = stepState(i);
              const clickable = i < step && !locked;
              return (
                <li key={name} className={`iw-stepper ${state}`} aria-current={i === step ? 'step' : undefined}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => w.goTo(i)}
                    aria-label={`Step ${i + 1}: ${name}`}
                    title={state === 'error' ? `${name}: needs attention` : STEP_SUMMARY[i]}
                  >
                    <span className="iw-stepper-n" aria-hidden="true">
                      {state === 'done' ? <Check size={13} /> : state === 'error' ? <CircleAlert size={13} /> : i + 1}
                    </span>
                    <span className="iw-stepper-text">
                      <span className="iw-stepper-name">{name}</span>
                      <span className="iw-stepper-sub">{STEP_SUMMARY[i]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="iw-main">
          <div className="iw-compact" aria-hidden="true">
            <span className="iw-compact-label">Step {step + 1} of {STEPS.length} · <strong>{STEPS[step]}</strong></span>
            <span className="iw-compact-bar"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></span>
          </div>

          <div className="iw-body" ref={bodyRef}>
            {step === STEP_SOURCE && <SourceStep w={w} headingRef={headingRef} />}
            {step === STEP_FORMAT && <FormatStep w={w} headingRef={headingRef} />}
            {step === STEP_TARGET && <TargetStep w={w} headingRef={headingRef} />}
            {step === STEP_COLUMNS && <ColumnsStep w={w} headingRef={headingRef} />}
            {step === STEP_OPTIONS && <OptionsStep w={w} headingRef={headingRef} />}
            {step === STEP_RUN && <RunStep w={w} headingRef={headingRef} />}
          </div>

          <footer className="iw-nav">
            <span className="iw-nav-msg" role="status" aria-live="polite">{hint}</span>
            <span className="iw-nav-spacer" />
            {step === STEP_RUN && w.running && (
              <button type="button" className="btn" disabled={!run.jobId || run.cancelling} onClick={() => void w.cancel()}>
                {run.cancelling ? 'Cancelling…' : 'Cancel import'}
              </button>
            )}
            {step === STEP_RUN && !w.running && !idleRun && (
              <>
                <button type="button" className="btn" onClick={w.restart}>Import another file</button>
                <button type="button" className="btn btn-primary" onClick={closeTab}>Close</button>
              </>
            )}
            {!(step === STEP_RUN && !idleRun) && (
              <>
                <button type="button" className="btn" onClick={back} disabled={step === STEP_SOURCE}>
                  <ChevronLeft size={14} aria-hidden="true" /> Back
                </button>
                {step === STEP_RUN ? (
                  <button type="button" className="btn btn-primary" onClick={next} disabled={!w.canNext[step]}>
                    <Play size={13} aria-hidden="true" /> Start import
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={next} disabled={!w.canNext[step]}>
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
