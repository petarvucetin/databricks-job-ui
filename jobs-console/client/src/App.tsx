import { Shell } from './components/Shell';
import { AttentionPage } from './pages/AttentionPage';
import { ComparePage } from './pages/ComparePage';

export default function App() {
  const compare = new URLSearchParams(window.location.search).has('compare');
  return (
    <Shell source="mock">
      {compare ? <ComparePage /> : <AttentionPage />}
    </Shell>
  );
}
