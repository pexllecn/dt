/** Entry: the 3D station by default; the simulation console at ?console. */
const params = new URLSearchParams(location.search);
if (params.has('console')) void import('./debug/main.ts');
else void import('./app/main.tsx');
