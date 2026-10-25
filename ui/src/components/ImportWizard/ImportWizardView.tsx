// Import Wizard tab: Source -> Format -> Target -> Mode -> Run (docs: Navicat's Import Wizard). The tab is lazy-loaded
// (./views.tsx); everything the shell needs at startup is in ./commands.ts and ./open.ts.
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { TabViewProps } from '../layout/tabViews';
import { FormatStep } from './FormatStep';
import { ModeStep } from './ModeStep';
import { RunStep } from './RunStep';
import { SourceStep } from './SourceStep';
import { TargetStep } from './TargetStep';
import { useWizard } from './useWizard';
import { STEP_FORMAT, STEP_MODE, STEP_RUN, STEP_SOURCE, STEP_TARGET, STEPS } from './wizardState';import './importWizard.css';

export function ImportWizardView({ tab, visible }: TabViewProps) {
  const w = useWizard(tab);
  const { s } = w;
  const step = s.step;
  const locked = w.running; // no navigation while the import runs

  const next = () => {
    if (step === STEP_MODE) void w.start();
    else w.goTo(step + 1);
  };
  const back = () => w.goTo(Math.max(STEP_SOURCE, step - 1));

  return (
    <div className="iw" data-testid="import-wizard" style={{ display: visible ? undefined : 'none' }} data-command-scope="importWizard">
      <ol className="iw-steps" aria-label="Import steps">
        {STEPS.map((name, i) => {
          const done = i < step;
          const clickable = done && !locked && step !== STEP_RUN;
          return (
            <li key={name} className={`iw-stepper${i === step ? ' current' : ''}${done ? ' done' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <button type="button" disabled={!clickable} onClick={() => w.goTo(i)} aria-label={`Step ${i + 1}: ${name}`}>
                <span className="iw-stepper-n">{i + 1}</span>
                <span className="iw-stepper-name">{name}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="iw-body">
        {step === STEP_SOURCE && <SourceStep w={w} />}
        {step === STEP_FORMAT && <FormatStep w={w} />}
        {step === STEP_TARGET && <TargetStep w={w} />}
        {step === STEP_MODE && <ModeStep w={w} />}
        {step === STEP_RUN && <RunStep w={w} />}
      </div>

      {step !== STEP_RUN && (
        <div className="iw-nav">
          {s.capsError && step !== STEP_MODE && <span className="iw-nav-msg iw-error-text" role="alert">{s.capsError}</span>}
          <span className="iw-nav-spacer" />
          <button type="button" className="btn" onClick={back} disabled={step === STEP_SOURCE}>
            <ChevronLeft size={14} /> Back
          </button>
          {step === STEP_MODE ? (
            <button type="button" className="btn btn-primary" onClick={next} disabled={!w.canNext[step]}>
              <Play size={13} /> Start import
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={next} disabled={!w.canNext[step]}>
              Next <ChevronRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
