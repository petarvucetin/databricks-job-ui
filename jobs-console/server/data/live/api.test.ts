import { describe, it, expect, vi, beforeEach } from 'vitest';

const ctor = vi.hoisted(() => ({ ws: vi.fn(), cfg: vi.fn() }));
vi.mock('@databricks/sdk-experimental', () => ({
  WorkspaceClient: class {
    constructor(opts: unknown) {
      ctor.ws(opts);
    }
  },
  Config: class {
    constructor(opts: unknown) {
      ctor.cfg(opts);
    }
    getHost() {
      return Promise.resolve(new URL('https://adb-1.cloud.databricks.com'));
    }
  },
}));

import { createSdkApi, resolveDefaultHost } from './api';

describe('explicit CLI profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createSdkApi passes the profile to WorkspaceClient', () => {
    createSdkApi({ profile: 'p' });
    expect(ctor.ws).toHaveBeenCalledWith({ profile: 'p' });
  });

  it('createSdkApi without a profile or token passes {}', () => {
    createSdkApi({});
    expect(ctor.ws).toHaveBeenCalledWith({});
  });

  it('resolveDefaultHost passes the profile to Config', async () => {
    expect(await resolveDefaultHost('p')).toBe('https://adb-1.cloud.databricks.com');
    expect(ctor.cfg).toHaveBeenCalledWith({ profile: 'p' });
    await resolveDefaultHost();
    expect(ctor.cfg).toHaveBeenLastCalledWith({});
  });
});
