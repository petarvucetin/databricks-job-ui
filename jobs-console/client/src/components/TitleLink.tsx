import type { ReactNode } from 'react';
import './titlelink.css';

/**
 * A run's title as a link to its own page in Databricks (new tab). Looks like plain text until hovered. The click stays
 * here: it does not also select the row or close the drawer. Without a url (mock data) the title is plain text.
 */
export function TitleLink({ url, children }: { url?: string; children: ReactNode }) {
  if (!url) return <>{children}</>;
  return (
    <a className="title-link" href={url} target="_blank" rel="noopener noreferrer" title="Open in Databricks" onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}
