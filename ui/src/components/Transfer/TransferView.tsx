// Data Transfer tab: Source -> Target -> Mapping -> Options -> Run, with the Import wizard's stepper, step layout and
// sticky footer (same CSS). Lazy-loaded (./views.tsx); the shell only loads ./commands.ts and ./open.ts at startup.
import { Check, ChevronLeft, ChevronRight, CircleAlert, Play } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { runCommand } from '../../commands/registry';
import { useUi } from '../../store/ui';
import '../ImportWizard/importWizard.css';
import type { TabViewProps } from '../layout/tabViews';
import { MappingStep } from './MappingStep';
import { STEP_MAPPING, STEP_OPTIONS, STEP_RUN, STEP_SOURCE, STEP_SUMMARY, STEP_TARGET, STEPS } from './model';
import { OptionsStep } from './OptionsStep';
import { RunStep } from './RunStep';
import { SourceStep } from './SourceStep';
import { TargetStep } from './TargetStep';
import './transfer.css';
import { useTransfer } from './useTransfer';

const OWN_ENTER = new Set(['BUTTON', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY']);

export function TransferView({ tab, visible }: TabViewProps) {
  const t = useTransfer(tab);
  const { s } = t;
  const step = s.step;
  const run = s.run;
  const finished = run.status === 'done';
  const locked = t.running || finished;
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

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
    if (step === STEP_RUN) void t.start();
    else t.goTo(step + 1);
  };
  const back = () => t.goTo(Math.max(STEP_SOURCE, step - 1));
  const closeTab = () => runCommand('tab.close', { kind: 'tab', tabId: tab.id });

  const requestCancel = async () => {
    const ok = await useUi.getState().askConfirm({
      title: 'Cancel the transfer?', message: 'The transfer stops after the current batch. Tables and rows already copied stay in the target.',
      confirmLabel: 'Cancel transfer', cancelLabel: 'Keep transferring', danger: true,
    });
    if (ok) void t.cancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (OWN_ENTER.has(el.tagName) || el.isContentEditable || el.closest('pre,[role="listbox"],[role="combobox"]')) return;
      if (step < STEP_RUN && t.canNext[step] && !locked) {
        e.preventDefault();
        next();
      }
    } else if (e.key === 'Escape' && t.running) {
      e.preventDefault();
      void requestCancel();
    }
  };

  const hint = !t.running && !finished && idleRun ? t.nextHint(step) : null;
  const stepState = (i: number): 'current' | 'done' | 'error' | 'todo' => {
    if (i === step) return 'current';
    if (i < step) return t.canNext[i] || i === STEP_RUN ? 'done' : 'error';
    return 'todo';
  };

  return (
    <div className="iw tr" data-testid="transfer-wizard" style={{ display: visible ? undefined : 'none' }} data-command-scope="transfer" onKeyDown={onKeyDown}>
      <div className="iw-shell">
        <nav className="iw-side" aria-label="Transfer progress">
          <ol className="iw-steps" aria-label="Transfer steps">
            {STEPS.map((name, i) => {
              const state = stepState(i);
              const clickable = i < step && !locked;
              return (
                <li key={name} className={`iw-stepper ${state}`} aria-current={i === step ? 'step' : undefined}>
                  <button type="button" disabled={!clickable} onClick={() => t.goTo(i)} aria-label={`Step ${i + 1}: ${name}`} title={STEP_SUMMARY[i]}>
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
            {step === STEP_SOURCE && <SourceStep t={t} headingRef={headingRef} />}
            {step === STEP_TARGET && <TargetStep t={t} headingRef={headingRef} />}
            {step === STEP_MAPPING && <MappingStep t={t} headingRef={headingRef} />}
            {step === STEP_OPTIONS && <OptionsStep t={t} headingRef={headingRef} />}
            {step === STEP_RUN && <RunStep t={t} headingRef={headingRef} />}
          </div>

          <footer className="iw-nav">
            <span className="iw-nav-msg" role="status" aria-live="polite">{hint}</span>
            <span className="iw-nav-spacer" />
            {step === STEP_RUN && t.running && (
              <button type="button" className="btn" disabled={!run.jobId || run.cancelling} onClick={() => void requestCancel()}>
                {run.cancelling ? 'Cancelling…' : 'Cancel transfer'}
              </button>
            )}
            {step === STEP_RUN && !t.running && !idleRun && (
              <>
                <button type="button" className="btn" onClick={t.restart}>New transfer</button>
                <button type="button" className="btn btn-primary" onClick={closeTab}>Close</button>
              </>
            )}
            {!(step === STEP_RUN && !idleRun) && (
              <>
                <button type="button" className="btn" onClick={back} disabled={step === STEP_SOURCE}>
                  <ChevronLeft size={14} aria-hidden="true" /> Back
                </button>
                {step === STEP_RUN ? (
                  <button type="button" className="btn btn-primary" onClick={next} disabled={!t.canNext[step]}>
                    <Play size={13} aria-hidden="true" /> Start transfer
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={next} disabled={!t.canNext[step]}>
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
