import { useAppStore } from './store';
import { DraftScreen } from './ui/DraftScreen';
import { SetupScreen } from './ui/SetupScreen';

export function App() {
  const phase = useAppStore((s) => s.phase);
  const lastError = useAppStore((s) => s.lastError);
  const dismissError = useAppStore((s) => s.dismissError);

  return (
    <div className="app">
      {lastError && (
        <div className="error-banner" role="alert">
          <span>{lastError}</span>
          <button onClick={dismissError}>Dismiss</button>
        </div>
      )}
      {phase === 'setup' ? <SetupScreen /> : <DraftScreen />}
    </div>
  );
}
