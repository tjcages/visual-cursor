# visual-cursor example: Vite + React

A minimal app wiring up `visual-cursor` end to end. Depends on the parent package via
`file:../..`, so it always reflects the current local build — run `npm run build` in the repo
root first if you've made changes there.

```bash
cd ../..
npm run build       # build the package this example depends on
cd examples/vite-react
npm install
INSPECT=1 npm run dev
```

Then hold **⌘**, hover a component, and **⌘-click** it.
