import { Shell } from './components/Shell';
import { useDataMode } from './hooks/useDataMode';
import { AttentionPage } from './pages/AttentionPage';
import { ComparePage } from './pages/ComparePage';

export default function App() {
  const compare = new URLSearchParams(window.location.search).has('compare');
  const mode = useDataMode();
  return (
    <Shell mode={mode}>
      {compare ? <ComparePage /> : <AttentionPage />}
    </Shell>
  );
}
