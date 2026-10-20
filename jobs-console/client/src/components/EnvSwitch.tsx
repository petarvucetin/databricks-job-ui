import { envUrl } from '../lib/env';
import type { Tab } from './Shell';

/** dev / stg / prod: a switch when several are configured (a real navigation, keeping the tab), else a label naming the one. */
export function EnvSwitch({ env, envs, tab }: { env: string; envs?: string[]; tab?: Tab }) {
  if (!envs) return <span className="env-label">{env}</span>;
  return (
    <span className="env">
      {envs.map((e) => (
        <button
          key={e}
          type="button"
          className={e === env ? 'on' : undefined}
          aria-pressed={e === env}
          onClick={() => {
            if (e !== env) window.location.assign(envUrl(e, tab));
          }}
        >
          {e}
        </button>
      ))}
    </span>
  );
}
