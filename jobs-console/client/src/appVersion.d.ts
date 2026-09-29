declare module 'virtual:app-version' {
  const appVersion: { version: string; commit: string; date: string };
  export default appVersion;
}
