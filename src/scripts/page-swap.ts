import { swapFunctions } from 'astro:transitions/client';

// ClientRouter normally replaces <body> and re-inserts persisted elements,
// and runs a native view transition whose overlay swallows :hover. Either
// one cancels the header's in-flight button transitions. Swap only <main>
// so the header is never detached, and skip the view transition in favor of
// a CSS fade on the new content.
document.addEventListener('astro:before-swap', (event) => {
  const nextMain = event.newDocument.querySelector('main');
  const currentMain = document.querySelector('main');
  if (!nextMain || !currentMain) return;

  const transition = event.viewTransition;
  transition.ready.catch(() => {});
  transition.skipTransition();

  event.swap = () => {
    const doc = event.newDocument;
    swapFunctions.deselectScripts(doc);
    swapFunctions.swapRootAttributes(doc);
    swapFunctions.swapHeadElements(doc);
    const restoreFocus = swapFunctions.saveFocus();
    nextMain.classList.add('page-enter');
    currentMain.replaceWith(document.adoptNode(nextMain));
    restoreFocus();
  };
});
